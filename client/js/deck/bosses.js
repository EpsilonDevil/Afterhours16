// The Gauntlet's bosses (GAUNTLET.md §9): 3 per phase plus 3 Finals, each with its own mechanic, plus the Nemesis
// boss (your highest-ranked Nemesis can take a phase boss's place, §8). Each boss is played by a named AI player.
// The mechanics are hooks combat.js calls with a small helper object X (so there is no import cycle):
//   setup(m, X)              at the start of the match (Twin Towers and the Dynasty bring more players)
//   offense / defense(m, o, X, k)  the card he commits on his k-th possession with / without the ball (otherwise his
//                            `cycle`, split into its scoring and its Stops cards: foes.js splitMoves)
//   hidden(m, o)             'full' (cards and total hidden) or 'cards' (the total shows): his set can't be read
//   hitCap                   a basket of yours that beats his Stops counts at most this; the rest is banked as Stops
//                            for his next defense (The Wall)
//   onPlay(m, card, X)       after you play a card (The Enforcer's hard fouls, the Press, the Nemesis's reads)
//   costMod(m, card)         cost change for one of your cards (the Full-Court Press)
//   drawMod                  cards drawn each turn (the Press: -1)
//   turnStart(m, o, X, side) at the start of every possession; side: 'offense' when he has the ball
//   onLow(m, o, X)           after he's hit (The Closer's takeover)
//   onDeath(m, o, X)         when he drops: true = he isn't done (The Undisputed's second half, the Dynasty's next man)
// v0.4.8.9 qp4: the fights are possessions (GAUNTLET.md §15). A boss commits one card a possession, from the side of
// the ball he's on, and the numbers decide it; his mechanic is the same, timed in his possessions.
//
// Balance reasoning (tuned with tools/deck_sim.mjs): a phase boss has ~3.5x a normal match's Heart and BOSS_DMG
// (2.4) on his authored moves (multi-player bosses author lighter moves, since they all act), scaled per phase by
// BOSS_PHASE, so a deck has to *work* to beat him in ~5 turns (~22 cards) before the damage piles up, and every
// mechanic punishes one lazy plan: big single hits (The Wall), long fights (The Phenom, Showtime's every-third-turn
// combo), a fat deck (Ref's Favorite's Fatigue, the Press's smaller hand), Shot spam (The Enforcer). The Finals
// need a complete deck (~8 turns). The smart policy beats a phase boss 55-95% of the time and ~4 in 5 failed runs
// end at a boss: the bosses are the walls. Values below are absolute for their phase (no PHASE_DMG applied).
// Called by: combat.js (the hooks), map.js (the pools); the UI through index.js bossInfo.

const S = (pts, o = {}) => ({ kind: 'shoot', pts, anim: 'jumper', ...o });
const D = (stops, o = {}) => ({ kind: 'defend', stops, anim: 'contest', ...o });
const B = (o) => ({ kind: 'buff', anim: 'celebrate', ...o });
const X_ = (o) => ({ kind: 'debuff', anim: 'crossover', ...o });

export const BOSSES = {
  // ---------- Phase 1 ----------
  the_wall: {
    id: 'the_wall', title: 'The Wall', phase: 1, heart: 80, court: 'warehouse',
    text: 'Huge Defense. No basket counts more than 10 against him, and he banks the rest as Stops for his next defense. Many small shots beat him.',
    cycle: [D(16, { pts: 5, kind: 'shoot', anim: 'block', name: 'Swats and runs' }), S(11, { anim: 'post', name: 'Post-up' }), B({ stops: 22, hot: 1, anim: 'block', name: 'Builds the Wall' }), S(6, { hits: 2, anim: 'dunk', name: 'Two dunks' })],
    hitCap: 10, // (combat.js: a basket that beats his Stops counts at most this; the excess is banked into his Stops)
  },
  showtime: {
    id: 'showtime', title: 'Showtime', phase: 1, heart: 80, court: 'longbeach',
    text: 'Every third time he has the ball he runs a combo of his own: three hits and Hot 1. On a fast break you can\'t read him.',
    offense(m, o, X, k) {
      if (k % 3 === 2) return { kind: 'special', pts: 5, hits: 3, hot: 1, anim: 'stepback', name: 'Showtime combo' };
      return k % 3 === 0 ? S(9, { anim: 'three', name: 'Logo three' }) : X_({ you: { exposed: 2 }, pts: 5, name: 'Ankle check' });
    },
    defense() { return B({ hot: 1, stops: 9, anim: 'celebrate', name: 'Plays to the crowd' }); },
    hidden(m, o) { return m.ball === 'them' && m.turnType === 'fast_break' ? 'full' : null; },
  },
  refs_favorite: {
    id: 'refs_favorite', title: 'Ref\'s Favorite', phase: 1, heart: 70, court: 'rec',
    text: 'The whistle loves him: a Ticky-Tack Foul goes into your draw pile every time he gets the ball, and his drives draw free throws.',
    cycle: [S(8, { fatigue: { id: 'cramp', n: 1 }, anim: 'foul', name: 'Flops into you' }), S(3, { hits: 3, anim: 'layup', name: 'Free-throw parade', foul: true }), D(11, { you: { cold: 1 }, kind: 'debuff', anim: 'foul', name: 'Works the ref' })],
    turnStart(m, o, X, side) { if (side !== 'offense') return; X.addCard(m, 'ticky_tack', 'draw'); X.ev(m, { type: 'fatigue', actor: X.oi(m, o), anim: 'foul', text: `${o.name} gets the whistle: a Ticky-Tack Foul goes in your deck.` }); },
  },
  // ---------- Phase 2 ----------
  professor: {
    id: 'professor', title: 'The Professor', phase: 2, heart: 140, court: 'schoolyard',
    text: 'Copies your last card. Every third time he has the ball, a Pop Quiz: Exposed 2 and Cold 1. He hides which card he plays; you see his total.',
    offense(m, o, X, k) {
      if (k % 3 === 2) return X_({ you: { exposed: 2, cold: 1 }, pts: 8, anim: 'stepback', name: 'Pop Quiz' });
      const c = X.lastCard(m);
      if (!c || c.type !== 'shot') return S(c ? 7 : 12, { anim: c ? c.anim : 'jumper', name: c ? `Copies your ${c.name}` : 'Lecture', ...(c && c.type !== 'defense' ? { hot: c.type === 'mentality' ? 2 : 1 } : {}) });
      return S(Math.max(8, Math.round(((c.fx.pts || 6) * (c.fx.hits || 1)) * 1.5)), { anim: c.anim, name: `Copies your ${c.name}`, copy: c.id });
    },
    defense(m, o, X) {
      const c = X.lastCard(m);
      if (c && c.type === 'defense') return D(Math.max(8, Math.round((c.fx.stops || 6) * 1.3)), { anim: c.anim, name: `Copies your ${c.name}`, copy: c.id });
      return D(10, { anim: 'contest', name: 'Takes notes' });
    },
    hidden() { return 'cards'; },
  },
  twin_towers: {
    id: 'twin_towers', title: 'Twin Towers', phase: 2, heart: 122, court: 'aau', twins: true,
    text: 'Two bigs who share one Heart. Both act every turn.',
    cycle: [S(6, { anim: 'post', stops: 6, name: 'Hook from the block' }), D(12, { anim: 'block', name: 'Twin walls' }), S(9, { anim: 'dunk', name: 'Lob slam' })],
    cycle2: [S(3, { hits: 2, anim: 'jumper', name: 'High-low' }), X_({ you: { gassed: 2 }, pts: 3, anim: 'post', name: 'Leans on you' }), D(10, { anim: 'rebound', name: 'Owns the glass' })],
    setup(m, X) { X.twin(m); },
  },
  the_closer: {
    id: 'the_closer', title: 'The Closer', phase: 2, heart: 92, court: 'rooftop',
    text: 'Gets better as the game gets tight: below half Heart he\'s Hot 3 and scores +50%; below a quarter every shot hits twice.',
    cycle: [S(10, { anim: 'jumper', name: 'Mid-range' }), D(13, { hot: 1, kind: 'defend', anim: 'contest', name: 'Locks in' }), S(4, { hits: 3, anim: 'three', name: 'Three straight' })],
    onLow(m, o, X) {
      if (!o.mv.half && o.heart <= o.maxHeart / 2) { o.mv.half = true; o.status.hot = (o.status.hot || 0) + 3; X.ev(m, { type: 'status', actor: X.oi(m, o), anim: 'celebrate', text: `${o.name} smells the finish: Hot 3.` }); }
      if (!o.mv.quarter && o.heart <= o.maxHeart / 4) { o.mv.quarter = true; X.ev(m, { type: 'status', actor: X.oi(m, o), anim: 'celebrate', text: `${o.name} takes over: every shot hits twice.` }); }
    },
    dmgMult(m, o) { return o.mv.half ? 1.5 : 1; },
    hitsMult(m, o) { return o.mv.quarter ? 2 : 1; },
  },
  // ---------- Phase 3 ----------
  the_enforcer: {
    id: 'the_enforcer', title: 'The Enforcer', phase: 3, heart: 144, court: 'cage',
    text: 'Hard fouls: every Shot card you play costs you 1 Health.',
    cycle: [S(15, { anim: 'dunk', name: 'Through you' }), X_({ you: { gassed: 2, exposed: 2 }, pts: 7, anim: 'foul', name: 'Hard foul' }), D(16, { anim: 'block', name: 'Stands his ground' }), S(7, { hits: 2, anim: 'post', name: 'Bully drives' })],
    onPlay(m, c, X) { if (c.type === 'shot') X.hurtYou(m, 1, 'foul', 'Hard foul: -1 Health.'); },
  },
  full_press: {
    id: 'full_press', title: 'Full-Court Press', phase: 3, heart: 175, court: 'projects',
    text: 'You draw 1 fewer card. Your first card each turn costs +1 unless it\'s a Pass card. Your first Pass card each turn breaks the press: +1 energy.',
    cycle: [S(11, { anim: 'steal', name: 'Trap and score', you: { screened: 1 } }), S(5, { hits: 3, anim: 'layup', name: 'Runs out' }), X_({ you: { cold: 2 }, fatigue: { id: 'heavy_legs', n: 2 }, anim: 'steal', name: 'Wears you down' }), D(13, { anim: 'steal', name: 'Picks you up full' })],
    drawMod: -1,
    costMod(m, c) { return m.t.played.length === 0 && !c.tags.includes('Pass') ? 1 : 0; },
    onPlay(m, c, X) { if (c.tags.includes('Pass') && !m.t.pressBroken) { m.t.pressBroken = true; m.energy += 1; X.ev(m, { type: 'energy', actor: 'you', anim: 'pass', text: 'You break the press: +1 energy.' }); } },
  },
  the_phenom: {
    id: 'the_phenom', title: 'The Phenom', phase: 3, heart: 210, court: 'riverside',
    text: 'He gets better every time he has the ball: Hot 1 at first, Hot 2 from his 2nd possession, Hot 3 from his 4th.',
    cycle: [S(9, { anim: 'jumper', name: 'Pull-up' }), S(4, { hits: 2, anim: 'layup', name: 'Euro and finish' }), D(11, { anim: 'block', name: 'Chase-down' }), S(13, { anim: 'dunk', name: 'Highlight dunk' })],
    turnStart(m, o, X, side) { if (side !== 'offense') return; const k = o.mv.offenseN || 0, n = k >= 3 ? 3 : k >= 1 ? 2 : 1; o.status.hot = (o.status.hot || 0) + n; X.ev(m, { type: 'status', actor: X.oi(m, o), anim: 'celebrate', text: `${o.name} is learning on the fly: Hot ${n}.` }); },
  },
  // ---------- the Final ----------
  undisputed: {
    id: 'undisputed', title: 'The Undisputed', phase: 4, heart: 118, court: 'overpass',
    text: 'A two-part fight. Drop him once and he comes back for the second half: fresh Heart, Hot 2, harder moves.',
    cycle: [S(12, { anim: 'jumper', name: 'Tough two' }), D(15, { kind: 'defend', anim: 'contest', name: 'Reads you' }), S(5, { hits: 3, anim: 'three', name: 'Range' }), X_({ you: { exposed: 2, cold: 1 }, pts: 6, name: 'Shows you up' })],
    cycle2: [S(16, { anim: 'dunk', name: 'No mercy' }), S(6, { hits: 3, anim: 'stepback', name: 'Three in a row' }), B({ hot: 2, stops: 16, anim: 'celebrate', name: 'Champion\'s poise' }), X_({ you: { gassed: 2, exposed: 2 }, pts: 9, anim: 'post', name: 'Bully ball' })],
    onDeath(m, o, X) {
      if (o.mv.second) return false;
      o.mv.second = true; o.maxHeart = Math.round(this.heart * 0.6); o.heart = o.maxHeart; o.stops = 0;
      o.status = { hot: (o.status.hot || 0) + 2 }; o.mv.offenseN = 0; o.mv.defenseN = 0;
      X.ev(m, { type: 'phase', actor: X.oi(m, o), anim: 'celebrate', text: `Second half. ${o.name} isn't done.` });
      return true;
    },
  },
  dynasty: {
    id: 'dynasty', title: 'The Dynasty', phase: 4, heart: 100, court: 'desert', trio: true,
    text: 'Three players who have won everything together. When one falls, the others get Hot 2 and heal 15.',
    cycle: [S(6, { anim: 'three', name: 'Corner three' }), D(10, { anim: 'contest', name: 'Switch everything' }), S(3, { hits: 2, anim: 'layup', name: 'Backdoor cut' })],
    setup(m, X) { X.trio(m); },
    onDeath(m, o, X) {
      for (const p of m.opps) if (p !== o && p.heart > 0) { p.status.hot = (p.status.hot || 0) + 2; p.heart = Math.min(p.maxHeart, p.heart + 15); }
      X.ev(m, { type: 'status', actor: X.oi(m, o), anim: 'celebrate', text: 'Next man up: the Dynasty gets Hot 2 and heals 15.' });
      return false;
    },
  },
  the_shadow: {
    id: 'the_shadow', title: 'The Shadow', phase: 4, heart: 320, court: 'market',
    text: 'He plays your own deck against you: every possession he draws 5 of your cards and plays them with your stats. You can\'t read a thing.',
    setup(m, X) { X.shadow(m); },
    offense(m, o, X) { return X.shadowSet(m, o, 'offense'); },
    defense(m, o, X) { return X.shadowSet(m, o, 'defense'); },
    hidden() { return 'full'; },
  },
  // ---------- your Nemesis, in a phase boss's place ----------
  nemesis: {
    id: 'nemesis', title: 'Nemesis', phase: 0, heart: 0, court: 'cage', nemesis: true,
    text: 'Your highest-ranked Nemesis, with everything he has learned about you. Every card you play of the tag he read best gives him 3 Stops for his next defense.',
    onPlay(m, c, X) { const o = m.opps[0], tag = o.mv.readTag; if (tag && c.tags.includes(tag) && o.heart > 0) { o.stops += 3; X.ev(m, { type: 'stops', actor: 0, anim: 'contest', stops: 3, text: `${o.name} saw that coming: +3 Stops.` }); } },
  },
};
Object.setPrototypeOf(BOSSES, null); // (lookups by id from saved state: no prototype members)
export const BOSS_POOLS = { 1: ['the_wall', 'showtime', 'refs_favorite'], 2: ['professor', 'twin_towers', 'the_closer'], 3: ['the_enforcer', 'full_press', 'the_phenom'], 4: ['undisputed', 'dynasty', 'the_shadow'] };
// the Nemesis as a boss: his style's moves at a phase boss's strength
export const NEMESIS_BOSS = { heart: { 1: 72, 2: 112, 3: 144 }, dmg: { 1: 2, 2: 2.8, 3: 3.6 } };
// every boss move's points are authored at its phase's scale; BOSS_DMG lifts them all together
export const BOSS_DMG = 2.4;
// and per phase on top (Heart, damage): later bosses face decks that have had more Coolers, Shops and upgrades to grow
export const BOSS_PHASE = { 1: [1, 1], 2: [1.2, 1.25], 3: [1.25, 1.3], 4: [1.2, 1.25] };
// court: the Pro-Am park (world/proamparks.js) the boss plays in; your Nemesis takes you to The Cage
export const bossInfo = id => { const b = BOSSES[id]; return b ? { id: b.id, title: b.title, phase: b.phase, text: b.text, court: b.court } : null; };
