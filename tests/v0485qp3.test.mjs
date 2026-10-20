// v0.4.8.5 quick patch 3: Y / Triangle jumps for a rebound off the ball on offense, half as many fouls in the park, and
// the ICON status (the endgame: every cap breaker, every badge maxed, 99 OVR): who has it, ICON before the archetype
// wherever it's shown, and the aura's steps by win streak. (The cursor and aura themselves: v0485iconfx.test.mjs; Open
// Arms: v0485openarms.test.mjs; the Sharp Eye release: v0485sharpeye.test.mjs; the Mash's soundtrack:
// v0485monstermusic.test.mjs.)
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, RULES } from '../client/js/sim/game.js';
import { makeTeam } from '../client/js/sim/bots.js';
import { RNG } from '../client/js/core/rng.js';
import { MatchSession } from '../client/js/game/session.js';
import { Input, newStickState, PAD } from '../client/js/core/input.js';
import { iconStatus, iconStatusInfo, winStreak, iconAuraLevel, badgeCaps, BADGE_IDS, HOF_LIMIT } from '../client/js/sim/builds.js';
import { archHTML, ICON_TAG } from '../client/js/ui/common.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const list = JSON.parse(src('server/catalog.json'));
const catalog = Object.fromEntries(list.map(i => [i.id, i]));
const game = (n = 2, opts = {}) => {
  const rng = new RNG(opts.seed || 4), team = makeTeam(rng, n, { catalog, level: 0.8 }), opp = makeTeam(rng, opts.opp ?? n, { catalog, level: 0.6 });
  team[0].human = true;
  return new Game({ mode: opts.mode || 'park', seed: opts.seed || 4, rosters: [team, opp], catalog });
};
// a gamepad with `btn` pressed this frame
function padInput(btn) {
  const inp = Object.create(Input.prototype);
  Object.assign(inp, { down: new Set(), pressed: new Set(), released: new Set(), capturing: false, lastDevice: 'gamepad' });
  inp.applyBinds({});
  const b = new Array(17).fill(false); b[PAD[btn]] = true;
  inp.gp = { connected: true, family: 'xbox', buttons: b, prev: new Array(17).fill(false), values: [], axes: [0, 0, 0, 0], rs: newStickState() };
  return inp;
}
const session = (inp, g) => { const s = Object.create(MatchSession.prototype); Object.assign(s, { input: inp, game: g, pend: {}, rig: { inputBasis: () => ({ rx: 1, rz: 0, fx: 0, fz: 1 }) }, defHands: null }); return s; };

test('off the ball on offense, Y jumps for the board; with the ball it is still the lob, on defense still the block', () => {
  const g = game(2), me = g.human, mate = g.mates(me)[0];
  g.changePossessionTo(mate); g.giveBall(mate, 'held'); g.phase = 'live';
  let s = session(padInput('Y'), g);
  s.captureInput();
  assert.equal(s.input.ctx, 'offball');
  assert.ok(s.pend.shoot && s.pend.shoot.jump, 'a jump press');
  // the step turns it into a jump (never a catch-and-shoot hold, even with a pass on its way to him)
  g.ball.mode = 'flight'; g.ball.kind = 'pass'; g.ball.info = { to: me.id };
  s.basis = { rx: 1, rz: 0, fx: 0, fz: 1 };
  const it = s.stepIntent();
  assert.equal(it.jump, true);
  assert.equal(it.shoot, null);
  // with the ball: Y is the lob pass, not a jump
  const g2 = game(2, { seed: 7 }), me2 = g2.human;
  g2.changePossessionTo(me2); g2.giveBall(me2, 'held'); g2.phase = 'live';
  s = session(padInput('Y'), g2);
  s.captureInput();
  assert.equal(s.input.ctx, 'offense');
  assert.ok(!s.pend.shoot, 'no jump with the ball');
  assert.equal(s.pend.pass?.type, 'lob');
  // on defense: the block it always was
  const g3 = game(2, { seed: 9 }), me3 = g3.human, opp = g3.teams[1][0];
  g3.changePossessionTo(opp); g3.giveBall(opp, 'dribble'); g3.phase = 'live';
  s = session(padInput('Y'), g3);
  s.captureInput();
  assert.equal(s.input.ctx, 'defense');
  assert.ok(s.pend.shoot && !s.pend.shoot.jump);
  // and the sim: a jump off the ball while a shot is up is a rebound jump
  const g4 = game(2, { seed: 11 }), me4 = g4.human;
  g4.phase = 'live';
  g4.ball.holder = -1; g4.ball.mode = 'flight'; g4.ball.kind = 'shot'; g4.ball.flightTime = 0.8; g4.ball.info = { shooter: g4.mates(me4)[0].id, team: me4.team };
  g4.startJump(me4);
  assert.equal(me4.action.type, 'rebound');
});

test('the park calls half as many fouls as before (shooting fouls and reach-ins)', () => {
  assert.equal(RULES.parkFoulK, 0.375);
  const gs = src('client/js/sim/game.js');
  assert.ok(gs.includes("if (this.mode === 'park') pf *= RULES.parkFoulK;"), 'shooting fouls');
  assert.ok(gs.includes("pf * (this.mode === 'park' ? RULES.parkFoulK : 1)"), 'reach-ins');
});

// a build that has done it all: max OVR 90 (30 Pro Run games), 25 cap breakers earned, every badge at its cap with the
// Hall of Fame slots full and the rest at Gold, 99 overall
function iconBuild(over = {}) {
  const c = { archetype: 'stretch_big', position: 'PF', height: 83, weight: 235, wingspan: 87, progression: { prorun_completed: 30 }, cap_breakers: { earned: 25 }, badges: {}, overall: 99, ...over };
  const caps = badgeCaps(c); let hof = 0;
  for (const k of BADGE_IDS) c.badges[k] = { tier: caps[k], progress: 0 }; // (v0.4.8.7: every badge at its cap, every Hall of Fame the build can reach)
  return c;
}

test('ICON status: every cap breaker, every badge maxed (the Hall of Fame slots full), 99 overall — all three', () => {
  const c = iconBuild();
  assert.equal(iconStatus(c), true);
  assert.deepEqual([iconStatusInfo(c).cap_breakers, iconStatusInfo(c).badges, iconStatusInfo(c).ovr], [true, true, 99]);
  assert.equal(iconStatus(iconBuild({ overall: 98 })), false, '98 OVR');
  assert.equal(iconStatus(iconBuild({ cap_breakers: { earned: 20 } })), false, 'a cap breaker short');
  assert.equal(iconStatus(iconBuild({ progression: { prorun_completed: 27 } })), false, 'cap breakers not open yet (max OVR 89)');
  const short = iconBuild(); const silver = BADGE_IDS.find(k => short.badges[k].tier >= 2); short.badges[silver].tier -= 1;
  assert.equal(iconStatus(short), false, 'a badge below what it can reach');
  assert.equal(iconStatusInfo(short).badges_left, 1);
  // the server's word wins when the character came from it
  assert.equal(iconStatus({ ...iconBuild({ overall: 80 }), icon_status: true }), true);
  assert.equal(iconStatus({ ...iconBuild(), icon_status: false }), false);
  assert.equal(iconStatus(null), false);
});

test('the aura: hidden below a 3-game streak, a step stronger every 3 wins, all the way at 12 and up', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13, 30].map(iconAuraLevel), [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
  assert.equal(winStreak({ win_streak: 7 }), 7);
  assert.equal(winStreak({ progression: { win_streak: 4 } }), 4);
  assert.equal(winStreak({}), 0);
});

test('ICON goes in front of the archetype wherever it shows, in the Icon badges\' animated spectrum', () => {
  assert.equal(archHTML({ archetype: 'stretch_big' }), 'Stretch Big');
  assert.equal(archHTML({ archetype: 'stretch_big', icon_status: true }), ICON_TAG + ' Stretch Big');
  assert.ok(ICON_TAG.includes('class="icon-status"') && ICON_TAG.includes('>ICON<'));
  const css = src('client/css/app.css');
  assert.match(css, /\.icon-status \{[^}]*background: var\(--hof-grad\)[^}]*background-clip: text[^}]*animation: hofShift 5s linear infinite/);
  // every place a build's archetype is shown goes through it
  for (const [f, n] of [['client/js/ui/screens.js', 1], ['client/js/ui/phone.js', 2], ['client/js/ui/myplayer.js', 4], ['client/js/ui/stats.js', 2], ['client/js/ui/modes.js', 1]]) {
    assert.ok((src(f).match(/archHTML\(/g) || []).length >= n, f);
    assert.ok(!/ARCHETYPES\[[^\]]+\]\?\.label/.test(src(f)), `${f}: no bare archetype label left`);
  }
  assert.ok(src('client/js/game/present.js').includes("p.icon ? '<span class=\"icon-status\">ICON</span> ' : ''"), 'the team intro cards');
  assert.ok(src('client/js/ui/myplayer.js').includes('function iconStatusCard(c)'), 'MyPlayer shows the status and what\'s left');
});
