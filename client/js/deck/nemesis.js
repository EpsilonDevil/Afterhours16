// The Gauntlet's nemesis system (GAUNTLET.md §8): a living AI world per account. Pure and seed-driven; the server
// stores the world (plain JSON) and validates it, the client runs these functions.
//
// world = { v: 1, aiSeed, runs, ticks, chars: { [charId]: char }, feed: [line] }
// char  = { id, name, rank 0-4, traits: [id], memories: [{k, text, run, phase}] (last 5), record: {w, l} (his wins and
//           losses against you), met, last (run index), idle, streak (his losses in a row to you), owes (0-3: you
//           helped him), grudge (0-3: you wronged him), turned (a rival of his got to him), rel: {[otherId]: kind} }
// kinds of relationship: 'rival', 'friend', 'mentor' (he mentors the other), 'protege'
//
// Balance reasoning:
//  * Rank +1 on beating you (and a learned trait), +1 at 50% when you dodge him: you meet ~25 characters a run and
//    lose to one, so a world grows ~1-2 ranks a run in total; regress at 2 straight losses to you or 3 idle runs
//    keeps the top from filling up (a Nemesis is earned, a Legend is rare).
//  * Grudges: wronging someone is +1 (his friends +1 too); beating a Rival or boss is +1 at 20%; a grudge fades by 1 at
//    30% a run you don't cross paths (after 2 idle runs), so a world settles at roughly a fifth of its people sore at you.
//  * Betrayal: a helped character betrays only when one of his rivals holds a grudge against you (35% + 15% per
//    grudge level), otherwise he's an ally (5% background). Helping is a good bet, wronging people with friends isn't.
// Called by: run.js newRun (the cast and the plot), events.js (lines); the UI and the server through index.js (worldAfterRun, worldTick, charLine).
import * as R from './rng.js';
import { RANKS, TRAITS, TRAIT_IDS, READ_TRAIT, styleFor } from './foes.js';

// the server keeps at most 120 characters and 64 KB of world: we stay well under both
export const MAX_CHARS = 80, MAX_MEM = 5, MAX_FEED = 12, MAX_BYTES = 56000, SERVER_CHARS = 120;
export const REL_KINDS = ['rival', 'friend', 'mentor', 'protege'];
const INV = { rival: 'rival', friend: 'friend', mentor: 'protege', protege: 'mentor' };
const PHASE_NAME = p => (p >= 4 ? 'the Final' : `Phase ${p}`);

export function emptyWorld(aiSeed = 1) { return { v: 1, aiSeed: aiSeed >>> 0 || 1, runs: 0, ticks: 0, chars: {}, feed: [] }; }
// a clean copy (the server sends it back; whatever it holds, the engine gets valid data)
export function normWorld(w) {
  const out = emptyWorld(w?.aiSeed);
  if (!w || typeof w !== 'object') return out;
  out.runs = Math.max(0, w.runs | 0); out.ticks = Math.max(0, w.ticks | 0);
  out.feed = Array.isArray(w.feed) ? w.feed.filter(x => typeof x === 'string').slice(-MAX_FEED) : [];
  for (const [id, c] of Object.entries(obj(w.chars)).slice(0, SERVER_CHARS)) {
    if (!/^ai-\d+$/.test(id) || !c || typeof c !== 'object') continue;
    out.chars[id] = {
      id, name: (typeof c.name === 'string' ? c.name : id).slice(0, 40), rank: clamp(c.rank | 0, 0, 4), traits: arr(c.traits).filter(t => typeof t === 'string' && TRAITS[t]).slice(0, 4),
      memories: arr(c.memories).filter(x => x && typeof x.text === 'string').slice(-MAX_MEM).map(x => ({ k: String(x.k || ''), text: x.text.slice(0, 120), run: x.run | 0, phase: x.phase | 0 })),
      record: { w: Math.max(0, obj(c.record).w | 0), l: Math.max(0, obj(c.record).l | 0) }, met: Math.max(0, c.met | 0), last: c.last | 0, idle: Math.max(0, c.idle | 0),
      streak: Math.max(0, c.streak | 0), owes: clamp(c.owes | 0, 0, 3), grudge: clamp(c.grudge | 0, 0, 3), turned: !!c.turned,
      rel: Object.fromEntries(Object.entries(obj(c.rel)).filter(([k, v]) => /^ai-\d+$/.test(k) && REL_KINDS.includes(v)).slice(0, 4)),
      style: typeof c.style === 'string' ? c.style : undefined,
    };
    if (!out.chars[id].style) delete out.chars[id].style;
  }
  for (const c of Object.values(out.chars)) for (const r of Object.keys(c.rel)) if (!out.chars[r]) delete c.rel[r]; // (no one who isn't there)
  return out;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const arr = x => (Array.isArray(x) ? x : []);
const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const clone = w => JSON.parse(JSON.stringify(w));
export const rankName = r => RANKS[clamp(r | 0, 0, 4)];

function remember(c, k, text, run, phase) { c.memories.push({ k, text, run, phase }); if (c.memories.length > MAX_MEM) c.memories.splice(0, c.memories.length - MAX_MEM); }
function newChar(id, name, style) { return { id, name, rank: 0, traits: [], memories: [], record: { w: 0, l: 0 }, met: 0, last: 0, idle: 0, streak: 0, owes: 0, grudge: 0, turned: false, rel: {}, ...(style ? { style } : {}) }; }
function relate(w, a, b, kind) {
  if (a === b || !w.chars[a] || !w.chars[b]) return;
  w.chars[a].rel[b] = kind; w.chars[b].rel[a] = INV[kind];
  for (const id of [a, b]) { const r = w.chars[id].rel, ks = Object.keys(r); if (ks.length > 4) delete r[ks[0]]; }
}
const ofKind = (c, kind) => Object.entries(c.rel || {}).filter(([, v]) => v === kind).map(([k]) => k);

// ---------- the cast of a run ----------
// Who appears, and how he plays, is outcome: it comes only from the seed, the nemesis world and `base`, an AIWorld the
// engine builds from world.aiSeed with no catalog (run.js aiFor), so the server's replay and the browser agree.
// The names and looks are cosmetic: they come from `ai` (the game's AIWorld, app.ai, whose seed should be the same
// world.aiSeed so they match the park) at `now` (default: its birth), or from `base` when there's no `ai`.
export const LEVELS = { match: [0.32, 0.55, 0.74, 0.86], rival: [0.48, 0.68, 0.84, 0.9], boss: [0.8, 0.88, 0.94, 0.97] };
export function makeCaster(run, world, ai, now, base = ai) {
  const st = R.stream(run.seed, 'cast');
  const used = new Set(), chars = run.chars;
  const known = Object.values(world.chars);
  const entryOf = (w, id, t) => { try { return w ? w.entry(id, t ?? w.born) : null; } catch { return null; } };
  const look = id => {
    const b = entryOf(base, id, base?.born)?.build || {}; // (outcome: archetype and position)
    const e = entryOf(ai || base, id, ai ? now : base?.born), lb = e?.build || {}; // (cosmetic)
    return { name: e?.name || world.chars[id]?.name || id, archetype: b.archetype || '', position: b.position || '',
      look: e ? { position: lb.position, height: lb.height, weight: lb.weight, wingspan: lb.wingspan, archetype: lb.archetype, hand: lb.hand, appearance: lb.appearance, equipment: lb.equipment, number: e.number, overall: lb.overall, tier: e.tier } : null };
  };
  const register = id => {
    if (!chars[id]) {
      const L = look(id), w = world.chars[id];
      chars[id] = { charId: id, name: w?.name && !L.look ? w.name : L.name, look: L.look, style: w?.style || styleFor(L.archetype, L.position), rank: w?.rank || 0, traits: (w?.traits || []).slice(), known: !!w,
        grudge: w?.grudge || 0, owes: w?.owes || 0 };
    }
    used.add(id);
    return chars[id];
  };
  const foe = c => ({ charId: c.charId, name: c.name, style: c.style, rank: c.rank, traits: c.traits.slice() }); // (the look stays in run.chars)
  const fresh = (kind, phase, key) => {
    const lv = LEVELS[kind][Math.min(4, phase) - 1];
    let id = null;
    if (base) { try { id = base.pick({ level: lv, exclude: used, online: false, key: `gauntlet${run.seed}-${key}` }); } catch { id = null; } }
    if (!id) { for (let k = 0; k < 50 && (!id || used.has(id)); k++) id = 'ai-' + R.int(st, 0, 899); }
    return register(id);
  };
  // known characters waiting to be placed: grudges and the highly ranked to Rival nodes first, the rest to matches
  const waiting = known.filter(c => !c.turned || c.grudge).map(c => c.id);
  const score = id => { const c = world.chars[id]; return c.grudge * 3 + c.rank * 2 + (c.record.w > 0 ? 1 : 0); };
  waiting.sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  const take = pred => { const i = waiting.findIndex(id => !used.has(id) && pred(world.chars[id])); return i < 0 ? null : waiting.splice(i, 1)[0]; };
  const nem = topNemesis(world);
  return {
    nemesis: nem,
    cast(kind, phase, round, nodeId, bossId) {
      if (kind === 'boss') {
        if (bossId === 'nemesis' && nem) return [foe(register(nem))];
        const n = bossId === 'twin_towers' ? 2 : bossId === 'dynasty' ? 3 : 1;
        return Array.from({ length: n }, (_, k) => foe(fresh('boss', phase, nodeId + 'b' + k)));
      }
      let id = null;
      if (kind === 'rival' && R.chance(st, 0.7)) id = take(c => c.grudge > 0 || c.rank >= 1 || c.record.w > 0);
      // (plain matches get the rest of your history; grudges and the ranked wait for a Rival node: they come looking for you)
      if (!id && R.chance(st, kind === 'rival' ? 0.3 : 0.22)) id = kind === 'rival' ? take(() => true) : take(c => !c.grudge && c.rank < 2);
      return [foe(id ? register(id) : fresh(kind, phase, nodeId))];
    },
    extra(kind, phase, key) { return foe(fresh(kind, phase, key)); },
    register: id => foe(register(id)),
  };
}
// your highest-ranked Nemesis (rank 3+), if any
export function topNemesis(world) {
  let best = null;
  for (const c of Object.values(world.chars || {})) if (c.rank >= 3 && !c.owes && (!best || c.rank > best.rank || (c.rank === best.rank && c.record.w > best.record.w))) best = c;
  return best ? best.id : null;
}

// ---------- the run's plot: allies and a betrayal ----------
export const LEND_CARD = { sniper: 'step_back_three+', slasher: 'tomahawk+', big: 'paint_patrol', playmaker: 'motion_offense', lockdown: 'shut_down+' };
export function makePlot(run, world, caster) {
  const st = R.stream(run.seed, 'plot');
  const plot = { lends: [], betray: null, allies: [], grudges: [] };
  const allies = Object.values(world.chars).filter(c => c.owes > 0 && !c.turned).sort((a, b) => b.owes - a.owes || (a.id < b.id ? -1 : 1)).slice(0, 2);
  plot.grudges = Object.values(world.chars).filter(c => c.grudge > 0).map(c => c.id).slice(0, 8);
  const nodesOf = (kinds, phases) => Object.values(run.map.phases.filter(p => phases.includes(p.phase)).reduce((a, p) => Object.assign(a, p.nodes), {})).filter(n => kinds.includes(n.kind));
  for (const c of allies) {
    const f = caster.register(c.id);
    const rivals = ofKind(c, 'rival').filter(r => (world.chars[r]?.grudge || 0) > 0);
    const p = rivals.length ? 0.35 + 0.15 * Math.max(...rivals.map(r => world.chars[r].grudge)) : 0.05;
    plot.allies.push(c.id);
    const lendAt = R.pick(st, nodesOf(['rival', 'match'], [1, 2]));
    if (lendAt) plot.lends.push({ charId: c.id, name: f.name, node: lendAt.id, card: LEND_CARD[f.style] || 'tomahawk+' });
    if (!plot.betray && R.chance(st, p)) {
      const at = R.pick(st, nodesOf(['boss'], [2, 3]));
      if (at) {
        const by = rivals.length ? world.chars[rivals[0]] : null;
        plot.betray = { charId: c.id, name: f.name, look: f.look, style: f.style, rank: f.rank, node: at.id, by: by?.id || null,
          line: charLine(world, c.id, 'betray', run.seed, { by: by?.name }) };
      }
    }
  }
  return plot;
}

// ---------- lines (generated, original: never anyone's real words) ----------
const L = {
  intro: ['Thought I\'d see you here.', 'You picked the wrong bracket.', 'Let\'s see what you\'ve got tonight.', 'My court, my rules.', 'I\'ve been waiting on this one.', 'Lace \'em up.'],
  introGrudge: ['I haven\'t forgotten.', 'You owe me, and I\'m collecting.', 'I told everybody what you did. They\'re watching.', 'This one\'s personal.'],
  introOwed: ['Good to see you. Don\'t expect me to go easy, though.', 'I owe you one. Not tonight.', 'Respect. Now let\'s hoop.'],
  introRank: { 2: 'They call me a Rival now. Your doing.', 3: 'Every run, I get better. You made me.', 4: 'Legends don\'t lose to the same guy twice.' },
  win: ['Sit down.', 'Go home and run it back.', 'That\'s what I thought.', 'Write that one down.', 'Too much for you.'],
  lose: ['Run it back next time.', 'Lucky. That\'s all.', 'You got me. Once.', 'I\'ll remember that.', 'Enjoy it while it lasts.'],
  boss: ['You made it this far? Cute.', 'Everybody gets here. Nobody gets past.', 'Welcome to the top of the bracket.', 'This is where runs end.'],
  ally: ['Take this. You\'d do the same.', 'I got you. Go get it.', 'You helped me once. Now we\'re square.', 'Use it well.'],
  betray: ['Nothing personal. {by} made me a better offer.', 'Sorry. {by} reminded me whose side I\'m on.', 'You should have seen this coming.', 'I owed you. I owed {by} more.'],
  help: ['I won\'t forget that.', 'Real one. Appreciate you.', 'I owe you.'],
  wrong: ['That\'s how it is? Okay.', 'Everybody\'s going to hear about this.', 'You\'ll see me again.'],
};
const MEMO = {
  beat_handle: p => `You broke my ankles in ${p}.`,
  beat_drive: p => `You dunked on me in ${p}.`,
  beat_post: p => `You bullied me in the post in ${p}.`,
  beat_perimeter: p => `You lit me up from deep in ${p}.`,
  beat_pass: p => `You passed me dizzy in ${p}.`,
  beat_hustle: p => `You outworked me in ${p}.`,
  beat: p => `You beat me in ${p}.`,
  won: p => `I sent you home in ${p}.`,
  dodged: p => `You ducked me in ${p}.`,
  helped: () => 'You helped me at the sideline.',
  wronged: () => 'You left me hanging.',
  lent: p => `I had your back in ${p}.`,
  betrayed: p => `I switched sides on you in ${p}.`,
  friend_wronged: () => 'You did my boy wrong.',
};
export function memoryText(k, phase) { return (MEMO[k] || MEMO.beat)(PHASE_NAME(phase)); }
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] || 'somebody');
export function charLine(world, charId, situation = 'intro', seed = 0, vars = {}) {
  const c = world?.chars?.[charId];
  const st = R.stream(seed, 'line', charId, situation, c?.memories?.length || 0);
  const pick = arr => R.pick(st, arr);
  let base;
  if (situation === 'intro' || situation === 'match') {
    if (c?.grudge) base = pick(L.introGrudge);
    else if (c?.owes) base = pick(L.introOwed);
    else if (c && L.introRank[c.rank]) base = R.chance(st, 0.5) ? L.introRank[c.rank] : pick(L.intro);
    else base = pick(L.intro);
    // shared history: his latest memory, said to you
    const mem = c?.memories?.length ? c.memories[c.memories.length - 1] : null;
    if (mem && R.chance(st, 0.75)) base = `${mem.text.replace(/^You /, 'You ').replace(/^I /, 'I ')} ${base}`;
  } else base = pick(L[situation] || L.intro);
  return fill(base, vars);
}

// ---------- after a run ----------
// summary.chars: [{ charId, name, style, result: 'beat'|'lost'|'helped'|'wronged'|'dodged'|'lent'|'betrayed', phase, tag, kind }]
export function worldAfterRun(world0, summary = {}, seed = 0) {
  summary = summary?.summary?.chars ? summary.summary : summary || {}; // (runOver(run) or its .summary)
  const w = normWorld(world0 ? clone(world0) : null);
  const st = R.stream(seed, 'after', w.runs);
  const feed = [];
  w.runs++;
  const runN = w.runs, seen = new Set();
  const get = o => { let c = w.chars[o.charId]; if (!c) { c = w.chars[o.charId] = newChar(o.charId, o.name || o.charId, o.style); } if (o.name) c.name = String(o.name).slice(0, 40); if (o.style && !c.style) c.style = o.style; return c; };
  const rankUp = (c, why) => { if (c.rank < 4) { c.rank++; feed.push(`${c.name} ${why} and is now a ${rankName(c.rank)}.`); } };
  const rankDown = (c, why) => { if (c.rank > 0) { c.rank--; feed.push(`${c.name} ${why}: down to ${rankName(c.rank)}.`); return true; } if (c.traits.length) { const t = c.traits.pop(); feed.push(`${c.name} ${why} and lost his edge (${TRAITS[t].name.toLowerCase()}).`); return true; } return false; };
  const learn = (c, tag) => {
    const want = READ_TRAIT[tag];
    const t = want && !c.traits.includes(want) ? want : R.pick(st, TRAIT_IDS.filter(x => !c.traits.includes(x)));
    if (!t) return;
    c.traits.push(t); if (c.traits.length > 4) c.traits.shift();
    feed.push(`${c.name}: ${TRAITS[t].name.toLowerCase()} (${TRAITS[t].text.replace(/\.$/, '')}).`);
  };
  for (const o of summary.chars || []) {
    if (!o || !/^ai-\d+$/.test(o.charId || '')) continue;
    const c = get(o), ph = clamp(o.phase | 0 || 1, 1, 4);
    if (!seen.has(c.id)) { seen.add(c.id); c.met++; c.last = runN; c.idle = 0; }
    const tagK = String(o.tag || '').toLowerCase();
    switch (o.result) {
      case 'lost': // he beat you
        c.record.w++; c.streak = 0;
        rankUp(c, 'sent you home'); learn(c, o.tag);
        remember(c, 'won', memoryText('won', ph), runN, ph);
        break;
      case 'beat': // you beat him
        c.record.l++; c.streak++;
        remember(c, 'beat', memoryText(MEMO['beat_' + tagK] ? 'beat_' + tagK : 'beat', ph), runN, ph);
        if (c.streak >= 2) { if (rankDown(c, `keeps losing to you`)) c.streak = 0; }
        else if (o.kind === 'rival' || o.kind === 'boss') { if (R.chance(st, 0.2)) { c.grudge = clamp(c.grudge + 1, 0, 3); feed.push(`${c.name} took that loss personally.`); } }
        break;
      case 'dodged':
        if (R.chance(st, 0.5)) { rankUp(c, 'survived the bracket while you went around him'); remember(c, 'dodged', memoryText('dodged', ph), runN, ph); }
        break;
      case 'helped':
        c.owes = clamp(c.owes + 1, 0, 3); c.grudge = clamp(c.grudge - 1, 0, 3); c.turned = false;
        remember(c, 'helped', memoryText('helped', ph), runN, ph);
        feed.push(`${c.name} tells people you're good people.`);
        break;
      case 'wronged': {
        c.grudge = clamp(c.grudge + 1, 0, 3); c.owes = 0;
        remember(c, 'wronged', memoryText('wronged', ph), runN, ph);
        if (c.grudge >= 2 && !c.traits.includes('vengeful')) { c.traits.push('vengeful'); if (c.traits.length > 4) c.traits.shift(); }
        // he recruits his friends
        const friends = ofKind(c, 'friend').concat(ofKind(c, 'protege')).filter(f => w.chars[f]);
        for (const f of friends.slice(0, 2)) { const fc = w.chars[f]; fc.grudge = clamp(fc.grudge + 1, 0, 3); remember(fc, 'friend_wronged', memoryText('friend_wronged', ph), runN, ph); }
        feed.push(friends.length ? `${c.name} is holding a grudge, and ${w.chars[friends[0]].name} is with him.` : `${c.name} is holding a grudge.`);
        break;
      }
      case 'lent':
        c.owes = clamp(c.owes - 1, 0, 3); remember(c, 'lent', memoryText('lent', ph), runN, ph);
        feed.push(`${c.name} had your back.`);
        break;
      case 'betrayed':
        c.owes = 0; c.turned = true; remember(c, 'betrayed', memoryText('betrayed', ph), runN, ph);
        feed.push(`${c.name} switched sides on you.`);
        break;
    }
  }
  // a new character meets the world: a relationship or two with the people already in it
  for (const id of seen) {
    const c = w.chars[id];
    if (Object.keys(c.rel).length || c.met > 1) continue;
    const others = Object.keys(w.chars).filter(x => x !== id).sort();
    if (!others.length) continue;
    const n = R.int(st, 0, 2);
    for (let k = 0; k < n; k++) relate(w, id, R.pick(st, others), R.weighted(st, [['rival', 3], ['friend', 3], ['mentor', 1], ['protege', 1]]));
  }
  // those who sat this one out
  for (const c of Object.values(w.chars)) if (!seen.has(c.id)) {
    c.idle++;
    if (c.idle >= 3 && (c.rank > 0 || c.traits.length) && R.chance(st, 0.4)) { if (rankDown(c, 'has been off the radar')) c.idle = 0; }
    // time heals: a grudge (and a debt) fades when you don't cross paths
    if (c.idle >= 2 && c.grudge && R.chance(st, 0.3)) { c.grudge--; if (!c.grudge) feed.push(`${c.name} has let it go.`); }
    if (c.idle >= 4 && c.owes && R.chance(st, 0.2)) c.owes--;
  }
  w.feed = w.feed.concat(feed).slice(-MAX_FEED);
  prune(w);
  return { world: w, feed };
}
function prune(w) {
  const ids = Object.keys(w.chars);
  const big = () => JSON.stringify(w).length > MAX_BYTES;
  if (ids.length <= MAX_CHARS && !big()) return;
  const keep = c => c.rank * 4 + c.grudge * 3 + c.owes * 3 + c.memories.length + (w.runs - c.last < 3 ? 5 : 0);
  ids.sort((a, b) => keep(w.chars[a]) - keep(w.chars[b]) || (a < b ? -1 : 1));
  const drop = id => { delete w.chars[id]; for (const c of Object.values(w.chars)) delete c.rel[id]; };
  let k = 0;
  for (; k < ids.length - MAX_CHARS; k++) drop(ids[k]);
  // and by size (the server's 64 KB): the least relevant go first, a few at a time
  while (big() && k < ids.length) { for (let j = 0; j < 4 && k < ids.length; j++) drop(ids[k++]); }
}

// ---------- between runs: the world ticks forward ----------
export function worldTick(world0, seed = 0) {
  const w = normWorld(world0 ? clone(world0) : null);
  const st = R.stream(seed, 'tick', w.ticks);
  w.ticks++;
  const feed = [];
  const ids = Object.keys(w.chars).sort();
  if (ids.length) {
    const events = Math.min(4, 1 + Math.floor(ids.length / 6));
    for (let e = 0; e < events; e++) {
      const c = w.chars[R.pick(st, ids)];
      const rivals = ofKind(c, 'rival').filter(x => w.chars[x]), friends = ofKind(c, 'friend').filter(x => w.chars[x]), proteges = ofKind(c, 'protege').filter(x => w.chars[x]);
      const roll = R.next(st);
      if (roll < 0.3 && rivals.length) { // a feud settles on the court
        const o = w.chars[R.pick(st, rivals)], cw = R.chance(st, 0.5 + 0.1 * (c.rank - o.rank));
        const [a, b] = cw ? [c, o] : [o, c];
        feed.push(`${a.name} and ${b.name} finally settled it: ${a.name} won.`);
        if (a.rank < 4 && R.chance(st, 0.4)) { a.rank++; feed.push(`${a.name} is a ${rankName(a.rank)} now.`); }
        if (b.rank > 0 && R.chance(st, 0.3)) b.rank--;
      } else if (roll < 0.5 && friends.length) { // they team up
        const o = w.chars[R.pick(st, friends)];
        const share = c.traits.find(t => !o.traits.includes(t));
        feed.push(`${c.name} and ${o.name} have been running together.`);
        if (share && o.traits.length < 4) { o.traits.push(share); feed.push(`${o.name} picked up ${c.name}'s ${TRAITS[share].name.toLowerCase()}.`); }
        if (c.grudge && !o.grudge) { o.grudge = 1; feed.push(`${o.name} has heard what you did to ${c.name}.`); }
      } else if (roll < 0.62 && proteges.length) { // a mentor teaches
        const o = w.chars[R.pick(st, proteges)];
        const t = c.traits.find(x => !o.traits.includes(x)) || R.pick(st, TRAIT_IDS.filter(x => !o.traits.includes(x)));
        if (t && o.traits.length < 4) { o.traits.push(t); feed.push(`${c.name} has been schooling ${o.name}: ${TRAITS[t].name.toLowerCase()}.`); }
      } else if (roll < 0.85) { // he trains
        if (c.rank < 2 && R.chance(st, 0.35)) { c.rank++; feed.push(`${c.name} has been in the gym every morning. ${rankName(c.rank)} now.`); }
        else feed.push(`${c.name} has been putting up shots after dark.`);
      } else if (ids.length > 1) { // a new beef or a new friendship
        const o = R.pick(st, ids.filter(x => x !== c.id && !c.rel[x]));
        if (o) { const kind = R.chance(st, 0.5) ? 'rival' : 'friend'; relate(w, c.id, o, kind); feed.push(kind === 'rival' ? `Word is ${c.name} and ${w.chars[o].name} can't stand each other.` : `${c.name} and ${w.chars[o].name} are tight now.`); }
      }
    }
  } else feed.push('The bracket is open. Nobody knows your name yet.');
  w.feed = w.feed.concat(feed).slice(-MAX_FEED);
  prune(w);
  return { world: w, feed };
}
