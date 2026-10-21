// v0.4.8.7 quick patch 4 (David: "address a visual bug causing badges displayed while activated to not reflect the
// proper tier of badge"). An activated badge pops up at the tier the build plays it at: its own tier, capped by its
// archetype and height (sim/builds.js capBadges: a Lockdown's shooting badges at Silver at best, v0.4.8.7 qp1), for you,
// the AI and the other players online alike; an Icon badge keeps its Icon look.
// The cause: in an online game the players are played with the entry each one last sent (ui/online.js). It was sent
// again when the build, its look, overall, RP, boosts or Icon status changed, but not its badges, so a badge that went up
// a tier in your last game played and popped at its old tier in the next one any of the others set up, on every screen
// (yours too), until something else changed. The entry is sent again on a badge tier change now (entryKey; the AI squad
// mates' too, aiSquadKey).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const catalog = Object.fromEntries(JSON.parse(src('server/catalog.json')).map(i => [i.id, i]));
globalThis.window = globalThis; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, createElement: () => ({ style: {}, getContext: () => null }), documentElement: {}, body: {} };

const { Game } = await import('../client/js/sim/game.js');
const { Player } = await import('../client/js/sim/player.js');
const { makeTeam } = await import('../client/js/sim/bots.js');
const { RNG } = await import('../client/js/core/rng.js');
const B = await import('../client/js/sim/builds.js');
const { badgeTiers } = await import('../client/js/game/park.js');
const Online = await import('../client/js/ui/online.js');
const { rankedBadges } = await import('../client/js/game/present.js');

const ARCHS = ['lockdown', 'sharpshooter', 'slasher', 'playmaker', 'glass_cleaner', 'two_way', 'stretch_big', 'post_scorer'];

test('every activated badge is popped at the tier the build plays it at (capped), the person\'s and the AI\'s alike', () => {
  let n = 0, capped = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const rng = new RNG(seed);
    const t0 = makeTeam(rng, 3, { catalog, level: 0.7 }), t1 = makeTeam(rng, 3, { catalog, level: 0.7 });
    const me = t0[0]; me.human = true;
    me.build.archetype = ARCHS[seed % ARCHS.length];
    // (every badge stored at Hall of Fame: what plays is each one's cap on this build)
    me.badges = Object.fromEntries(Object.keys(B.badgeCaps(me.build)).map(k => [k, 4]));
    const g = new Game({ mode: 'park', seed, rosters: [t0, t1], catalog, target: 21, difficulty: 0.6 });
    g.assist = true;
    const want = new Map(g.players.map(p => [p.id, B.capBadges(p.entry.badges || {}, p.entry.build)]));
    for (let i = 0; i < 60 * 60 * 5 && !g.over; i++) {
      g.step(1 / 60);
      for (const e of g.events) {
        if (e.type !== 'badge') continue;
        n++;
        if (e.icon) { assert.equal(e.tier, 5); continue; }
        const w = want.get(e.player)[e.badge];
        assert.equal(e.tier, w, `${e.badge} of player ${e.player}: popped ${e.tier}, plays at ${w}`);
        assert.equal(e.tier, g.players[e.player].badges[e.badge]);
        if (g.players[e.player].entry === me && B.badgeCaps(me.build)[e.badge] < 4) capped++;
      }
    }
  }
  assert.ok(n > 100, `badge pops: ${n}`);
  assert.ok(capped > 0, 'and some of them were badges capped below Hall of Fame on that build');
});

test('a player in a game plays his badges capped, whatever his entry says (a stored tier above the cap, a remote entry)', () => {
  const rng = new RNG(3), e = makeTeam(rng, 1, { catalog, level: 0.7 })[0];
  e.build.archetype = 'lockdown';
  e.badges = { deadeye: 4, limitless: 3, pick_pocket: 4, catch_shoot: 1 };
  const p = new Player(0, 0, e, catalog);
  const cap = B.badgeCaps(e.build);
  assert.equal(cap.deadeye, 2, 'a Lockdown shoots Silver at best (v0.4.8.7 qp1)');
  assert.deepEqual(p.badges, { deadeye: 2, limitless: Math.min(3, cap.limitless), pick_pocket: Math.min(4, cap.pick_pocket), catch_shoot: 1 });
  // the intro cards (game/present.js) and the MyPlayer screen show the same tier
  const char = { ...e.build, badges: Object.fromEntries(Object.entries(e.badges).map(([k, t]) => [k, { tier: t, progress: 0 }])) };
  assert.deepEqual(badgeTiers(char), p.badges, 'your own entry, capped the same way');
  for (const b of rankedBadges({ build: char, badges: badgeTiers(char) })) assert.equal(b.tier, p.badges[b.key] || 0, b.key);
});

test('online: a badge that changes tier sends your entry again (it used to wait for something else to change)', () => {
  const c = { id: 'c1', overall: 88, archetype: 'sharpshooter', height: 76, equipment: { top: 'yard_teal' }, boosts: {}, badges: { deadeye: { tier: 2, progress: 0 }, limitless: { tier: 3, progress: 0 } }, progression: {} };
  const k0 = Online.entryKey(c);
  assert.equal(Online.entryKey(structuredClone(c)), k0, 'nothing changed: not sent again');
  const up = structuredClone(c); up.badges.deadeye.tier = 3;
  assert.notEqual(Online.entryKey(up), k0, 'Deadeye Silver to Gold: sent again');
  const prog = structuredClone(c); prog.badges.deadeye.progress = 50;
  assert.equal(Online.entryKey(prog), k0, '(progress alone isn\'t a new tier: not sent again)');
  // as the build plays it: a Lockdown's Deadeye stored at Gold or Hall of Fame is the same Silver
  const lk = { ...structuredClone(c), archetype: 'lockdown', badges: { deadeye: { tier: 3, progress: 0 } } };
  const lk2 = structuredClone(lk); lk2.badges.deadeye.tier = 4;
  assert.equal(Online.entryKey(lk2), Online.entryKey(lk));
  // the other things still send it again
  for (const f of [x => { x.overall = 89; }, x => { x.equipment.top = 'other'; }, x => { x.boosts = { shooting: 1 }; }, x => { x.id = 'c2'; }]) { const y = structuredClone(c); f(y); assert.notEqual(Online.entryKey(y), k0); }
  assert.equal(Online.entryKey(null), null);
  // and the entry it sends carries those tiers
  const app = { char: () => up, look: () => ({}), net: null };
  assert.deepEqual(Online.myEntry(app).badges, badgeTiers(up));
  // your AI squad mates: a badge tier change sends them again too
  const ai = [{ id: 'ai-1', entry: { build: { overall: 80, equipment: {} }, badges: { deadeye: 2 } } }];
  const a2 = structuredClone(ai); a2[0].entry.badges.deadeye = 3;
  assert.notEqual(Online.aiSquadKey(a2), Online.aiSquadKey(ai));
  assert.equal(Online.aiSquadKey(structuredClone(ai)), Online.aiSquadKey(ai));
  // (the key is what the once-a-second check compares)
  const ol = src('client/js/ui/online.js');
  assert.match(ol, /const key = entryKey\(app\.char\(\)\);\n\s+if \(key !== lastChar\) \{ lastChar = key; net\.sendEntry\(\); \}/);
  assert.match(ol, /aiKey = aiSquadKey\(ai\);\n\s+if \(aiKey !== lastAI\) \{ lastAI = aiKey; net\.send\(\{ t: 'aisquad', members: ai \}\); \}/);
});

test('the pop shows the tier it was given: its art, its name and its colours; an Icon badge keeps its Icon look', async () => {
  const made = [];
  globalThis.document.createElement = () => { const d = { className: '', innerHTML: '', classList: { add() {}, remove() {} }, remove() {} }; made.push(d); return d; };
  globalThis.requestAnimationFrame = () => 0;
  const { HUD } = await import('../client/js/game/hud.js');
  const { badgeSVG, iconBadgeSVG } = await import('../client/js/ui/badgeart.js');
  const strip = s => s.replace(/id="[^"]*"|url\(#[^)]*\)/g, '');
  const hud = Object.create(HUD.prototype);
  Object.assign(hud, { badgeQ: [], badgeT: 0, badgeBox: { appendChild() {} } });
  const TIER = ['', 'Bronze', 'Silver', 'Gold', 'Hall of Fame'];
  for (const tier of [1, 2, 3, 4]) {
    hud.badge({ key: 'deadeye', tier, name: 'Deadeye' }); hud.showNextBadge();
    const d = made.at(-1);
    assert.equal(d.className, `badge-pop tier${tier}`);
    assert.ok(d.innerHTML.includes(`BADGE ACTIVATED · ${TIER[tier]}`), `${TIER[tier]}: ${d.innerHTML.slice(0, 80)}`);
    assert.ok(strip(d.innerHTML).includes(strip(badgeSVG('deadeye', tier, 42))), `${TIER[tier]}: its own art`);
  }
  hud.badge({ key: 'sharp_eye', tier: 5, name: 'Sharp Eye', icon: true }); hud.showNextBadge();
  assert.equal(made.at(-1).className, 'badge-pop icon');
  assert.ok(made.at(-1).innerHTML.includes('ICON BADGE ACTIVATED'));
  assert.ok(strip(made.at(-1).innerHTML).includes(strip(iconBadgeSVG('sharp_eye', 77)).slice(0, 200)));
  // the same badge at another tier straight after isn't swallowed as a repeat (only the same badge, tier and player is)
  hud.badgeQ = []; hud.badge({ key: 'deadeye', tier: 2, name: 'D' }); hud.badge({ key: 'deadeye', tier: 2, name: 'D' }); hud.badge({ key: 'deadeye', tier: 3, name: 'D' });
  assert.deepEqual(hud.badgeQ.map(b => b.tier), [2, 3]);
  // and the game hands the HUD the event's own tier
  assert.match(src('client/js/game/session.js'), /hud\.badge\(\{ key: e\.badge, tier: e\.tier, name: bd\?\.name \|\| e\.badge/);
});
