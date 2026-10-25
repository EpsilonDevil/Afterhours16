// v0.4.8.9 The Gauntlet, the Hub agent's part (docs/GAUNTLET.md §1-§11): what every Gauntlet screen shows, as HTML
// from the engine's state (deck/index.js). Pure: no DOM, no fetch, no court; ui/gauntlet.js puts these on the screen and
// wires them up, and tests/v0489gauntletui.test.mjs renders them straight from engine states.
//   setupHTML      run setup: three rolled starters and your converted players, four 1-10 stat bars each, the
//                  "word on the street" feed
//   mapHTML        the phase's bracket, bottom to top: Match, Rival, Cooler, Boost Shop, Mystery Stop, Boss; the path
//                  taken, the nodes you can pick, each one's opponent and rules
//   matchHTML      the card table under the court: the hand, energy, the four stats, Stops, each opponent's Heart and
//                  intent, the scoreboard, the match rules, the draw / discard / burn piles, End Turn
//   rewardHTML, coolerHTML, shopHTML, eventHTML, bossIntroHTML, preMatchHTML, summaryHTML, pileHTML, deckHTML
import * as D from '../deck/index.js';

export const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const STAT_KEYS = ['stamina', 'shooting', 'defense', 'health'];
export const STAT_LABEL = { stamina: 'Stamina', shooting: 'Shooting', defense: 'Defense', health: 'Health' };
const STAT_TIP = { stamina: 'Energy each turn', shooting: '+⌊stat/2⌋ on every Shot', defense: '+⌊stat/2⌋ Stops on every Defense card', health: 'Max Health 30 + 6 × stat' };
export const KIND_LABEL = { match: 'Match', rival: 'Rival', cooler: 'Cooler', shop: 'Boost Shop', event: 'Mystery Stop', boss: 'Boss' };
const KIND_ICON = {
  match: '<path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2.2a5.8 5.8 0 0 1 4.7 2.4H5.3A5.8 5.8 0 0 1 10 4.2Zm-5.8 5.8c0-.4 0-.7.1-1.1h11.4l.1 1.1-.1 1.1H4.3l-.1-1.1Zm1.1 3.4h9.4a5.8 5.8 0 0 1-9.4 0Z" fill="currentColor"/>',
  rival: '<path d="m10 1.5 2.4 5 5.5.6-4.1 3.7 1.2 5.4L10 13.5l-5 2.7 1.2-5.4L2.1 7.1l5.5-.6L10 1.5Z" fill="currentColor"/>',
  cooler: '<path d="M4 6h12v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Zm-1-3h14v2H3V3Zm4 6v2h6V9H7Z" fill="currentColor"/>',
  shop: '<path d="M3 3h2l1.6 8.2a1.5 1.5 0 0 0 1.5 1.3h6.6a1.5 1.5 0 0 0 1.5-1.2L17.5 6H6.2M8 17a1.4 1.4 0 1 0 0-2.8A1.4 1.4 0 0 0 8 17Zm7 0a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  event: '<path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-.9 12.5h1.8v1.8H9.1v-1.8Zm.9-10a3.2 3.2 0 0 1 3.2 3.2c0 1.6-1.2 2.2-1.9 2.8-.4.3-.4.6-.4 1.2H9.1c0-1.3.4-2 1.2-2.6.6-.5 1.1-.8 1.1-1.4a1.4 1.4 0 0 0-2.8 0H6.8A3.2 3.2 0 0 1 10 4.5Z" fill="currentColor"/>',
  boss: '<path d="M2 15 4 5l4 4 2-6 2 6 4-4 2 10H2Zm0 1.5h16V18H2v-1.5Z" fill="currentColor"/>',
};
export const kindIcon = k => `<svg class="gx-ki" viewBox="0 0 20 20" aria-hidden="true">${KIND_ICON[k] || KIND_ICON.match}</svg>`;
export const RANKS = ['Streetballer', 'Contender', 'Rival', 'Nemesis', 'Legend'];
const rankName = r => (typeof D.rankName === 'function' ? D.rankName(r) : RANKS[r] || RANKS[0]);
const TYPE_LABEL = { shot: 'Shot', defense: 'Defense', move: 'Move', play: 'Play', mentality: 'Mentality', fatigue: 'Fatigue' };
const KEYWORDS = { Burn: 'Burns: gone for the match once played.', Hold: 'Stays in your hand at the end of the turn.', Hot: 'Hot: +1 on every Shot per stack.', Cold: 'Cold: scores 25% less.', Gassed: 'Gassed: Defense gives 25% less.', Exposed: 'Exposed: takes 50% more.', Hustle: 'Hustle: Stops that last a turn.', Clutch: 'Clutch: stronger at half Health or less.', Combo: 'Combo: a bonus if the last card this turn had that tag.', Flow: 'Flow: three different tags in a turn: +1 energy, draw 1.', Depth: 'Depth: stronger with a bigger deck.', Tight: 'Tight: stronger with 12 cards or fewer.' };
const keywordHTML = text => esc(text).replace(/\b(Burn|Hold|Hot|Cold|Gassed|Exposed|Hustle|Clutch|Combo|Flow|Depth|Tight)\b/g, (m) => `<b class="gx-kw" title="${esc(KEYWORDS[m] || '')}">${m}</b>`);

// ---------------- small pieces ----------------
export function statBars(stats = {}, opts = {}) {
  return `<div class="gx-stats ${opts.compact ? 'compact' : ''}">${STAT_KEYS.map(k => {
    const v = Math.max(0, Math.min(10, Math.round(+stats[k] || 0))), base = opts.base?.[k];
    return `<div class="gx-stat s-${k}" title="${esc(STAT_TIP[k])}"><span>${STAT_LABEL[k]}</span><i class="gx-bar">${Array.from({ length: 10 }, (_, i) => `<em class="${i < v ? 'on' : ''} ${i >= 5 ? 'hi' : ''}"></em>`).join('')}</i><b>${v}</b>${base != null ? `<small>base ${base}</small>` : ''}</div>`;
  }).join('')}</div>`;
}
export const hpBar = (hp, max, cls = '') => `<span class="gx-hp ${cls}"><i style="width:${max ? Math.max(0, Math.min(100, hp / max * 100)) : 0}%"></i><b>${Math.max(0, Math.round(hp))}/${Math.round(max)}</b></span>`;
// a card: cost, name, type, tags, text (h: the hand's view of it: cost now, playable, points / Stops it would give)
export function cardHTML(ref, h = null, o = {}) {
  const c = D.cardInfo(ref), cost = h ? h.cost : c.cost;
  const cls = ['gx-card', `t-${c.type}`, `r-${c.rarity}`, c.upgraded ? 'up' : '', h && !h.playable ? 'off' : '', h?.offPhase ? 'held' : '', h?.combo ? 'combo' : '', o.flow ? 'flow' : '', h?.lent ? 'lent' : '', o.cls || ''].filter(Boolean).join(' ');
  const val = h && (h.points || h.stops) ? `<span class="gx-val">${h.points ? `${h.hits > 1 ? `${Math.round(h.points / h.hits)}×${h.hits}` : h.points} pts` : ''}${h.points && h.stops ? ' · ' : ''}${h.stops ? `${h.stops} Stops` : ''}</span>` : '';
  const attrs = o.attrs || '';
  return `<${o.tag || 'button'} class="${cls}" ${attrs} title="${esc(c.name)}: ${esc(c.text)}${h && !h.playable && h.why ? ` (${esc(h.why)})` : ''}">
    <span class="gx-cost">${cost == null ? '–' : cost}</span>
    ${o.key ? `<kbd class="gx-key">${esc(o.key)}</kbd>` : ''}
    <span class="gx-cname">${esc(c.name)}</span>
    <span class="gx-ctype">${esc(TYPE_LABEL[c.type] || c.type)}${c.rarity && !['starter', 'fatigue', 'special'].includes(c.rarity) ? ` · ${esc(c.rarity)}` : ''}</span>
    <span class="gx-ctext">${keywordHTML(c.text)}</span>
    <span class="gx-tags">${(c.tags || []).map(t => `<i class="tg-${esc(t.toLowerCase())}">${esc(t)}</i>`).join('')}</span>
    ${val}${h?.offPhase ? `<span class="gx-badge held" title="${esc(h.why || 'Waits for the other side of the ball')}">HELD</span>` : h?.combo ? '<span class="gx-badge combo">COMBO</span>' : o.flow ? '<span class="gx-badge flow">FLOW</span>' : ''}${h?.lent ? '<span class="gx-badge lent">LENT</span>' : ''}
    ${h?.offPhase && h.why ? `<span class="gx-held-why">${esc(h.why)}</span>` : ''}
  </${o.tag || 'button'}>`;
}
const statusHTML = st => Object.entries(st || {}).filter(([, n]) => n).map(([k, n]) => `<i class="gx-st st-${esc(k)}" title="${esc(KEYWORDS[k[0].toUpperCase() + k.slice(1)] || k)}">${esc(k[0].toUpperCase() + k.slice(1))} ${n}</i>`).join('');
const abilitiesHTML = ids => (ids || []).map(id => { const a = D.abilityInfo(id); return `<i class="gx-ab r-${esc(a.rarity)}" title="${esc(a.name)}: ${esc(a.text)}">${esc(a.name)}</i>`; }).join('');
// the bar across the top of every run screen: who you are, Health, coins, deck, abilities, the phase
export function runBarHTML(run) {
  const ph = run.phase > 3 ? 'The Final' : `Phase ${run.phase} of 3`;
  return `<div class="gx-runbar"><b class="gx-who">${esc(run.player.name)}${run.player.converted ? ' <em class="gx-conv">CONVERTED</em>' : ''}</b>${hpBar(run.hp, run.maxHp)}
    <span class="gx-coins" title="Coins">${run.coins}<small>coins</small></span><button class="gx-pill" data-gx="deck">Deck · ${run.deck.length}</button>
    <span class="gx-phase">${ph}</span><span class="gx-abs">${abilitiesHTML(run.abilities)}</span>${statBars(run.player.stats, { compact: true })}</div>`;
}

// ---------------- run setup ----------------
// players: [{player, kind: 'starter' | 'converted'}]; profile: {stats, feed, world}; saved: a run you can resume
// notice: { kind: 'update', text } (qp4: the server is on another engine version); engine: this game's ENGINE_VERSION (a
// saved run on other rules can only be ended)
export function setupHTML({ players = [], profile = null, saved = null, feed = [], offline = false, notice = null, engine = null } = {}) {
  const st = profile?.stats || {};
  const oldRules = !!saved && engine != null && (saved.engine ?? 1) !== engine;
  const card = (p, i, kind) => `<div class="gx-pcard ${kind}"><div class="gx-pk">${kind === 'converted' ? 'CONVERTED ICON' : 'STARTER'}</div><h3>${esc(p.name)}</h3>${kind === 'converted' && (p.overall || p.position) ? `<div class="gx-pmeta">${p.overall ? `<b>${esc(p.overall)}</b> OVR` : ''}${p.position ? ` · ${esc(p.position)}` : ''}${p.archetype ? ` · ${esc(String(p.archetype).replace(/_/g, ' '))}` : ''}</div>` : ''}
    ${statBars(p.stats, { base: kind === 'converted' ? p.base : null })}
    <p class="muted small">${D.maxHpForStat ? '' : ''}Health ${30 + 6 * (p.stats.health || 1)} · ${(p.stats.stamina || 1) >= 9 ? 5 : (p.stats.stamina || 1) >= 5 ? 4 : 3} energy a turn · +${Math.floor((p.stats.shooting || 0) / 2)} on Shots · +${Math.floor((p.stats.defense || 0) / 2)} on Defense</p>
    <button class="btn primary" data-pick-player="${i}">Run with ${esc(p.name)}</button></div>`;
  return `<section class="gx-setup"><div class="gx-head"><div class="eyebrow">THE GAUNTLET</div><h1>Run the Gauntlet</h1>
    <p class="muted">Three phases of bracket play and the Final. Build a deck as you go, read every opponent's next move, and remember: the people you beat remember you too.</p></div>
    ${notice?.kind === 'update' ? `<div class="gx-notice" data-notice="update"><b>Update needed</b><p>${esc(notice.text || 'Update the game to play the Gauntlet.')} This copy of the game plays a different version of its rules than the server does.</p><button class="btn ghost" data-gx="dismiss">OK</button></div>` : ''}
    ${saved && oldRules ? `<div class="gx-notice" data-notice="old-rules"><b>Run from the old rules</b><p>${esc(saved.player.name)}'s run (${saved.phase > 3 ? 'the Final' : `Phase ${saved.phase}`}) was started before the Gauntlet played in possessions, so it can't be continued. End it here: what it won is paid by its counts.</p><button class="btn primary" data-gx="end-old">End the run</button></div>` : ''}
    ${saved && !oldRules ? `<div class="gx-resume"><div><b>Run in progress</b><small>${esc(saved.player.name)} · ${saved.phase > 3 ? 'The Final' : `Phase ${saved.phase}`} · ${Math.round(saved.hp)}/${saved.maxHp} Health · ${saved.deck.length} cards</small></div><button class="btn primary" data-gx="resume">Resume</button><button class="btn ghost" data-gx="abandon">Abandon</button></div>` : ''}
    <div class="gx-setup-cols"><div class="gx-players">${players.map((x, i) => card(x.player, i, x.kind)).join('')}</div>
    <aside class="gx-feed"><h4>Word on the street</h4>${feed.length ? `<ul>${feed.slice(-8).reverse().map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="muted small">Nobody\'s talking yet. Run the Gauntlet and they will.</p>'}
      <h4>Your record</h4><p class="small">${st.started ?? st.runs ?? 0} runs · ${st.completed ?? 0} completed${st.bestPhase ? ` · best: ${st.bestPhase > 3 ? 'the Final' : `Phase ${st.bestPhase}`}` : ''}${st.vc ? ` · ${Number(st.vc).toLocaleString('en-US')} VC earned` : ''}</p>
      ${unlocksHTML(profile?.unlocks)}
      ${offline ? '<p class="muted small">The Gauntlet\'s server side isn\'t here yet: this run plays and saves on this computer.</p>' : ''}</aside></div></section>`;
}

// the next sacrifice's gate (server/gauntlet.py unlocks): how far along the account is
export function unlocksHTML(u) {
  if (!u || typeof u !== 'object') return '';
  const nx = u.next;
  if (!nx) return '<p class="small gx-unlock done">All three sacrifices are done.</p>';
  const g = nx.needs || {}, h = nx.have || {};
  const runs = `${Math.min(h.completed | 0, g.completed | 0)}/${g.completed | 0} completed run${g.completed === 1 ? '' : 's'}${g.distinct ? ` · ${Math.min(h.distinct | 0, g.distinct)}/${g.distinct} different players` : ''}`;
  return `<p class="small gx-unlock ${nx.ready ? 'ready' : ''}"><b>Sacrifice ${nx.n | 0} of 3</b> (${esc(String(nx.tier || '').replace(/^./, c => c.toUpperCase()))} park card): ${nx.ready ? 'ready. Sacrifice an ICON 99 build in MyPLAYER.' : esc(runs)}</p>`;
}

// ---------------- the bracket ----------------
export function mapHTML(run, opts = {}) {
  const mv = D.mapView(run);
  if (!mv) return '<p class="muted">No bracket.</p>';
  const avail = new Set(D.availableNodes(run)), rows = mv.rows, n = rows.length;
  const path = new Set(run.log?.nodes || []);
  const pos = {};
  rows.forEach((row, r) => row.forEach(nd => { pos[nd.id] = { x: 6 + nd.x * 88, y: 100 - (r + 0.5) / n * 100 }; }));
  const lines = rows.flatMap(row => row.flatMap(nd => nd.next.filter(id => pos[id]).map(id => {
    const a = pos[nd.id], b = pos[id], taken = path.has(nd.id) && path.has(id);
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${taken ? 'taken' : avail.has(id) && run.at === nd.id ? 'open' : ''}"/>`;
  }))).join('');
  const node = nd => {
    const st = nd.here ? 'here' : nd.cleared || path.has(nd.id) ? 'done' : avail.has(nd.id) ? 'open' : 'locked';
    const foe = nd.foes[0], boss = nd.boss;
    const label = boss ? esc(boss.title) : foe ? `${esc(foe.name)}<small>${esc(rankName(foe.rank))}</small>` : esc(KIND_LABEL[nd.kind]);
    const p = pos[nd.id];
    return `<button class="gx-node k-${nd.kind} ${st}" style="left:${p.x}%;top:${p.y}%" data-node="${esc(nd.id)}" ${st === 'open' ? '' : 'tabindex="-1" aria-disabled="true"'} title="${esc(KIND_LABEL[nd.kind])}${foe ? ' · ' + esc(foe.name) : ''}${nd.rules.length ? ' · ' + esc(nd.rules.map(r => r.name).join(', ')) : ''}">
      ${kindIcon(nd.kind)}<span class="gx-nl"><em>${esc(KIND_LABEL[nd.kind])}</em>${(nd.kind === 'match' || nd.kind === 'rival' || nd.kind === 'boss') ? `<b>${label}</b>` : ''}</span>${nd.rules.length ? `<i class="gx-nr">${nd.rules.length}</i>` : ''}</button>`;
  };
  const sel = opts.focus ? rows.flat().find(x => x.id === opts.focus) : rows.flat().find(x => avail.has(x.id));
  return `<section class="gx-map">${runBarHTML(run)}<div class="gx-map-cols">
    <div class="gx-bracket" style="--rows:${n}"><div class="gx-ph">${run.phase > 3 ? 'THE FINAL' : `PHASE ${run.phase}`}</div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${rows.flat().map(node).join('')}</div>
    <aside class="gx-preview" data-preview>${sel ? previewHTML(sel, run) : '<p class="muted">Pick where you go next.</p>'}</aside></div></section>`;
}
// what you see of a node before you pick it: the opponent, his rank and style, the rules, the boss
export function previewHTML(nd, run) {
  const wc = id => run?.wc?.[id];
  const foes = (nd.foes || []).map(f => { const w = wc(f.charId); return `<div class="gx-foe"><b>${esc(f.name)}</b><small>${esc(rankName(f.rank))}${f.style ? ' · ' + esc(f.style) : ''}</small>${w ? `<p class="gx-hist">${w.grudge ? '<i class="bad">Holds a grudge</i>' : ''}${w.owes ? '<i class="good">Owes you one</i>' : ''}${(w.memories || []).slice(-2).map(m => `<span>“${esc(typeof m === 'string' ? m : m.text || '')}”</span>`).join('')}</p>` : ''}</div>`; }).join('');
  return `<div class="gx-pv k-${nd.kind}"><div class="eyebrow">${esc(KIND_LABEL[nd.kind])} · ROUND ${nd.round + 1}</div>
    ${nd.boss ? `<h3>${esc(nd.boss.title)}</h3><p>${esc(nd.boss.text)}</p>` : ''}${foes}
    ${nd.rules.length ? `<h4>Rules</h4>${nd.rules.map(r => `<div class="gx-rule"><b>${esc(r.name)}</b><small>${esc(r.text)}</small></div>`).join('')}` : nd.kind === 'match' || nd.kind === 'rival' ? '<p class="muted small">No special rules.</p>' : ''}
    ${nd.kind === 'cooler' ? '<p>Rest (heal 30% of your max Health) or watch film (upgrade a card).</p>' : nd.kind === 'shop' ? '<p>Spend coins on cards and abilities, or pay to cut a card.</p>' : nd.kind === 'event' ? '<p>Something happens. Somebody you know, maybe.</p>' : nd.kind === 'rival' ? '<p class="small">Harder, and pays an ability.</p>' : ''}</div>`;
}

// ---------------- the match ----------------
// view: { hand: D.handView(run), target, busy (plays still on the court), last: [text lines], over }
export function matchHTML(run, view = {}) {
  const m = run.match;
  if (!m) return '';
  const hand = view.hand || D.handView(run), tgt = view.target ?? 0;
  // (the Flow chain from the engine: deck/combat.js flowView; flowLeft null once every Flow this turn is used)
  const fv = hand.flow || D.flowView(run), chain = fv.chain || [], flowLeft = (fv.flows || 0) < (fv.max || 1) ? fv.need : null;
  const statNow = { stamina: run.player.stats.stamina, shooting: (m.stats?.shooting ?? run.player.stats.shooting) + (m.mods?.shooting || 0), defense: (m.stats?.defense ?? run.player.stats.defense) + (m.mods?.defense || 0), health: run.player.stats.health };
  // (qp4: an opponent's button is who he is and how much Heart he has left; what he's playing this possession is the set
  // panel beside them: run.match.foeSet, face up or face down)
  const opp = (o, i) => {
    const down = o.heart <= 0;
    return `<button class="gx-opp ${down ? 'down' : ''} ${i === tgt && !down ? 'tgt' : ''}" data-target="${i}" ${down ? 'disabled' : ''}>
      <span class="gx-on">${esc(o.name)}${o.boss ? ' <em>BOSS</em>' : ''}<small>${esc(rankName(o.rank))}</small></span>${hpBar(o.heart, o.maxHeart, 'heart')}
      ${o.stops ? `<span class="gx-stops opp">${o.stops} Stops</span>` : ''}<span class="gx-sts">${statusHTML(o.status)}</span></button>`;
  };
  // while the possession plays out on the court the table shows that clash (view.lastClash), not the next one's
  const foeWho = m.opps.filter(o => o.heart > 0).map(o => o.name).join(' & ');
  const possession = view.busy
    ? (view.lastClash ? `<div class="gx-clash r-played" data-clash><span class="gx-cl-you"><small>${view.lastClash.youOff ? 'YOU · O' : 'YOU · D'}</small><b>${esc(view.lastClash.you)}</b></span><span class="gx-cl-vs">vs</span><span class="gx-cl-them"><b>${esc(view.lastClash.them)}</b><small>${view.lastClash.youOff ? 'D · THEM' : 'O · THEM'}</small></span><em class="gx-cl-res">${esc(view.lastClash.text)}</em></div>` : '')
    : `${foeSetHTML(m.foeSet, { side: m.foeSet?.side || (m.ball === 'them' ? 'offense' : 'defense'), who: foeWho })}`;
  const keys = '1234567890';
  // (qp7 §1: the hand max, and a card drawn past it waiting on an answer)
  const handMax = m.handMax ?? D.HAND_MAX ?? 5, pd = m.pendingDraw || null;
  return `<section class="gx-match ${view.busy ? 'busy' : ''} ${pd ? 'pending-draw' : ''}">
    <div class="gx-courttop">
      <div class="gx-score"><span class="you"><b>${esc(run.player.name)}</b><em data-score="0">${view.score ? view.score[0] : m.score[0]}</em></span><span class="mid"><small>${esc(KIND_LABEL[m.kind] || 'Match')}${m.boss ? ' · ' + esc(D.bossInfo(m.boss)?.title || '') : ''}</small><b>POSS. ${m.turn}</b></span><span class="them"><em data-score="1">${view.score ? view.score[1] : m.score[1]}</em><b>${esc(m.opps.length > 1 ? m.opps.map(o => o.name.split(' ').pop()).join(' & ') : m.opps[0]?.name || '')}</b></span></div>
      ${view.busy ? '' : turnBannerHTML(m).replace('class="gx-turn', 'class="gx-turn gx-turn-top')}
      <div class="gx-caption" data-caption>${esc(view.caption || '')}</div>
      <div class="gx-cine-ctl"><button class="gx-pill" data-gx="skip" title="Skip the play (Space)">Skip ▸</button><button class="gx-pill ${view.fast ? 'on' : ''}" data-gx="fast" title="Fast-forward (F)">▸▸</button><button class="gx-pill" data-gx="pause" data-cancel title="Menu (Esc)">Menu</button></div>
    </div>
    <div class="gx-table">
      <div class="gx-opps">${m.opps.map(opp).join('')}<div class="gx-possession" data-possession>${possession}</div></div>
      <div class="gx-row">
        <div class="gx-me">
          <div class="gx-energy" title="Energy (Stamina)"><b>${m.energy}</b><small>/${m.maxEnergy}</small></div>
          <div class="gx-mev">${hpBar(m.you.hp, m.you.maxHp)}${m.you.stops ? `<span class="gx-stops">${m.you.stops} Stops</span>` : '<span class="gx-stops none">0 Stops</span>'}<span class="gx-sts">${statusHTML(m.you.status)}</span></div>
          ${statBars(statNow, { compact: true })}
          ${flowLeft != null ? `<div class="gx-flow ${chain.length || fv.wild ? 'on' : ''}" title="Three different tags in one turn: Flow (+1 energy, draw 1)">FLOW${fv.max > 1 ? ` ${fv.flows}/${fv.max}` : ''} ${chain.map(t => `<i class="tg-${esc(String(t).toLowerCase())}">${esc(t)}</i>`).join('')}${fv.wild ? `<i class="tg-wild">ANY${fv.wild > 1 ? ' ×' + fv.wild : ''}</i>` : ''}<small>${flowLeft ? `${flowLeft} more tag${flowLeft > 1 ? 's' : ''}` : 'ready'}</small></div>` : '<div class="gx-flow done">FLOW · used this turn</div>'}
        </div>
        <div class="gx-handwrap ${pd ? 'drawq' : ''}">
          ${pd ? drawPromptHTML(m, pd) : ''}
          <div class="gx-hand" data-hand>${hand.map((h, i) => { const c = D.cardInfo(h.ref); if (pd) return cardHTML(h.ref, { ...h, playable: true, offPhase: false, why: null }, { attrs: `data-card="${i}" data-discard="${i}"`, key: keys[i] || '', cls: 'discard' }); const flow = flowLeft != null && flowLeft > 0 && (c.tags || []).some(t => !chain.includes(t)) && h.playable; return cardHTML(h.ref, h, { attrs: `data-card="${i}"`, key: keys[i] || '', flow }); }).join('') || '<p class="muted">No cards in hand.</p>'}</div>
          <div class="gx-handcount ${handMax > 5 ? 'raised' : ''}" data-handmax title="${handMax > 5 ? `Your hand holds ${handMax} cards this match` : 'Your hand holds 5 cards'}">Hand <b>${m.hand.length}/${handMax}</b>${handMax > 5 ? ' <em>▲</em>' : ''}</div>
        </div>
        <div class="gx-side">
          ${view.busy ? '' : clashBarHTML(m)}
          <button class="btn primary gx-end" data-gx="end" ${view.over || view.busy || pd ? 'disabled' : ''} ${pd ? 'title="Discard a card or refuse the new one first"' : ''}>${m.ball === 'them' ? 'Defend' : 'Play it out'} <kbd>E</kbd></button>
          <div class="gx-piles"><button class="gx-pile" data-pile="draw">Draw<b>${m.drawPile.length}</b></button><button class="gx-pile" data-pile="discard">Discard<b>${m.discard.length}</b></button><button class="gx-pile" data-pile="burned">Burn<b>${m.burned.length}</b></button></div>
          <div class="gx-rules">${m.rules.length ? m.rules.map(r => `<span class="gx-rule" title="${esc(r.text)}"><b>${esc(r.name)}</b><small>${esc(r.text)}</small></span>`).join('') : '<span class="muted small">No special rules</span>'}</div>
          ${m.powers?.length ? `<div class="gx-powers">${m.powers.map(p => `<i>${esc(D.cardName ? D.cardName(p.id) : p.id)}</i>`).join('')}</div>` : ''}
          <div class="gx-log">${(view.last || []).slice(-4).map(t => `<span>${esc(t)}</span>`).join('')}</div>
        </div>
      </div>
    </div>
    ${view.over ? `<div class="gx-overbar ${view.over.won ? 'win' : 'loss'}"><b>${view.over.won ? 'Game. You win.' : 'You\'re out.'}</b><button class="btn primary" data-gx="continue">Continue</button></div>` : ''}
  </section>`;
}
// qp7 §1: the question over the hand when a draw goes past the hand max: the card that's waiting, what to do, Refuse
export function drawPromptHTML(m, pd) {
  const c = pd.cardInfo || D.cardInfo(pd.ref), max = pd.handMax ?? m.handMax ?? 5;
  return `<div class="gx-drawq" data-drawq role="alertdialog" aria-label="Hand full">
    <div class="gx-dq-card">${cardHTML(pd.ref, null, { tag: 'div', cls: 'mini' })}</div>
    <div class="gx-dq-text"><b>Hand full (${m.hand.length}/${max}):</b> discard a card to take <em>${esc(c.name)}</em>, or refuse it.${pd.remaining > 0 ? ` <small>${pd.remaining} more to draw after this one.</small>` : ''}<small class="gx-dq-keys">Pick a card below (1-0) · <kbd>R</kbd> refuses</small></div>
    <button class="btn gx-dq-refuse" data-gx="refuse-draw">Refuse <kbd>R</kbd></button></div>`;
}
// qp7 §2: the Gauntlet's menu (Esc, the Menu button, B): its two ways out, always
export function pauseHTML(o = {}) {
  return `<div class="gx-pause" data-gx-pause><div class="eyebrow">THE GAUNTLET</div><h2>Paused</h2>
    <div class="gx-opts">
      <button class="gx-opt" data-gxp="resume" data-close><b>Resume</b></button>
      ${o.hasRun ? `<button class="gx-opt" data-gxp="bracket"><b>Back to the bracket</b><small>${o.inMatch ? 'Reloads your run from its last save. The match picks up from its last saved possession.' : 'Reloads your run from its last save.'}</small></button>` : ''}
      <button class="gx-opt" data-gxp="leave"><b>Leave the Gauntlet</b><small>${o.hasRun ? 'Back to the menus. Your run is saved: Resume it from the Gauntlet tab.' : 'Back to the menus.'}</small></button>
    </div></div>`;
}
// qp7 §2: what's left after repeated faults: nothing on it can fail; the two ways out
export function safeHTML() {
  return `<section class="gx-summary gx-safe"><div class="gx-panel"><div class="eyebrow">THE GAUNTLET</div><h1>Something went wrong.</h1>
    <p>The screen couldn't be drawn. Your run is saved as it was after your last move.</p>
    <div class="row gap end"><button class="btn ghost" data-gx="leave-gx">Leave the Gauntlet</button><button class="btn primary" data-gx="bracket">Back to the bracket</button></div></div></section>`;
}
export function pileHTML(title, refs) {
  const counts = new Map(); for (const r of refs) counts.set(r, (counts.get(r) || 0) + 1);
  return `<div class="gx-pileview"><h2>${esc(title)} <small class="muted">${refs.length} cards</small></h2><div class="gx-grid">${[...counts].sort((a, b) => D.cardInfo(a[0]).name < D.cardInfo(b[0]).name ? -1 : 1).map(([r, n]) => `<div class="gx-gc">${cardHTML(r, null, { tag: 'div' })}${n > 1 ? `<b class="gx-n">×${n}</b>` : ''}</div>`).join('') || '<p class="muted">Empty.</p>'}</div></div>`;
}
export const deckHTML = run => pileHTML('Your deck', run.deck);

// before the tip: the nemesis characters' lines (charLine), the boss's card
export function preMatchHTML(run, lines = []) {
  const m = run.match; if (!m) return '';
  const boss = m.boss ? D.bossInfo(m.boss) : null;
  return `<div class="gx-pre ${boss ? 'boss' : ''}">${boss ? bossIntroHTML(run) : ''}<div class="eyebrow">${esc(KIND_LABEL[m.kind] || 'MATCH')}${m.rules.length ? ' · ' + esc(m.rules.map(r => r.name).join(' · ')) : ''}</div>
    ${boss ? '' : `<h2>${esc(m.opps.map(o => o.name).join(' & '))}</h2>`}
    ${lines.map(l => `<blockquote><b>${esc(l.name)}</b>“${esc(l.text)}”</blockquote>`).join('')}
    ${m.rules.map(r => `<div class="gx-rule"><b>${esc(r.name)}</b><small>${esc(r.text)}</small></div>`).join('')}
    <div class="row gap end"><button class="btn primary" data-gx="tipoff">Tip off</button></div></div>`;
}
export function bossIntroHTML(run) {
  const m = run.match, b = m?.boss ? D.bossInfo(m.boss) : null;
  if (!b) return '';
  return `<div class="gx-bossintro"><div class="eyebrow">${run.phase > 3 ? 'THE FINAL' : `PHASE ${run.phase} BOSS`}</div><h1>${esc(b.title)}</h1><h3>${esc(m.opps[0]?.name || '')}</h3><p>${esc(b.text)}</p></div>`;
}

// ---------------- after a match, the stops ----------------
export function rewardHTML(run) {
  const rw = run.reward; if (!rw) return '';
  const abs = rw.abilities?.length ? rw.abilities : rw.ability ? [rw.ability] : [];
  return `<section class="gx-reward">${runBarHTML(run)}<div class="gx-panel"><div class="eyebrow">YOU WON · +${rw.coins} COINS</div><h2>Take a card</h2>
    <div class="gx-choices">${rw.cards.map((r, i) => cardHTML(r, null, { attrs: `data-reward-card="${i}"` })).join('')}</div>
    ${abs.length ? `<h3>${abs.length > 1 ? 'Pick an ability' : 'And an ability'}</h3><div class="gx-abchoices">${abs.map((id, i) => { const a = D.abilityInfo(id); return `<button class="gx-abcard r-${esc(a.rarity)}" data-reward-ability="${i}"><b>${esc(a.name)}</b><small>${esc(a.rarity)}</small><span>${esc(a.text)}</span></button>`; }).join('')}</div>` : ''}
    <div class="row gap end"><button class="btn ghost" data-gx="skip-card">Skip the card</button><button class="btn primary" data-gx="take" disabled>Take it</button></div></div></section>`;
}
export function coolerHTML(run, pick = null) {
  const v = D.coolerView ? D.coolerView(run) : { options: [{ id: 'heal', text: 'Rest', enabled: true }, { id: 'upgrade', text: 'Upgrade a card', enabled: true }, { id: 'skip', text: 'Move on', enabled: true }] };
  return `<section class="gx-cooler">${runBarHTML(run)}<div class="gx-panel"><div class="eyebrow">COOLER</div><h2>Take a breather</h2>
    ${pick ? cardPickerHTML(run, pick) : `<div class="gx-opts">${v.options.map(o => `<button class="gx-opt" data-cooler="${esc(o.id)}" ${o.enabled ? '' : 'disabled'}><b>${esc(o.text)}</b></button>`).join('')}</div>`}</div></section>`;
}
// a card from your deck: to upgrade (each with what it becomes) or to remove
export function cardPickerHTML(run, kind) {
  const up = kind === 'upgrade';
  return `<h3>${up ? 'Upgrade a card' : 'Remove a card'}</h3><div class="gx-grid pick">${run.deck.map((r, i) => {
    const can = up ? D.canUpgrade(r) : run.deck.length > 1;
    const plus = up && can ? D.cardInfo(r + '+') : null;
    return `<button class="gx-gc pickable" data-pick-card="${i}" ${can ? '' : 'disabled'}>${cardHTML(r, null, { tag: 'div' })}${plus ? `<span class="gx-arrow">▸</span>${cardHTML(r + '+', null, { tag: 'div', cls: 'preview' })}` : ''}</button>`;
  }).join('')}</div><div class="row gap end"><button class="btn ghost" data-gx="pick-back">Back</button></div>`;
}
export function shopHTML(run, pick = null) {
  const s = D.shopView(run);
  return `<section class="gx-shop">${runBarHTML(run)}<div class="gx-panel"><div class="eyebrow">BOOST SHOP · ${run.coins} COINS</div><h2>What'll it be?</h2>
    ${pick ? cardPickerHTML(run, 'remove') : `<div class="gx-choices shop">${s.cards.map((c, i) => `<div class="gx-buy ${c.sold ? 'sold' : ''}">${cardHTML(c.ref, null, { tag: 'div' })}<button class="btn small" data-buy-card="${i}" ${c.sold || run.coins < c.price ? 'disabled' : ''}>${c.sold ? 'Sold' : `${c.price} coins`}${c.sale ? ' · sale' : ''}</button></div>`).join('')}</div>
    <h3>Abilities</h3><div class="gx-abchoices">${s.abilities.map((a, i) => { const A = D.abilityInfo(a.id); return `<div class="gx-buy ab ${a.sold ? 'sold' : ''}"><div class="gx-abcard r-${esc(A.rarity)}"><b>${esc(A.name)}</b><small>${esc(A.rarity)}</small><span>${esc(A.text)}</span></div><button class="btn small" data-buy-ability="${i}" ${a.sold || run.coins < a.price ? 'disabled' : ''}>${a.sold ? 'Sold' : `${a.price} coins`}</button></div>`; }).join('') || '<p class="muted small">None today.</p>'}</div>
    <div class="row gap end"><button class="btn" data-gx="remove" ${s.removeUsed || run.coins < s.removePrice ? 'disabled' : ''}>Cut a card · ${s.removePrice} coins</button><button class="btn primary" data-gx="leave">Leave</button></div>`}</div></section>`;
}
// what an event's effect did, in words
export function effectText(f, run = null) {
  if (typeof f === 'string') return f;
  if (!f || typeof f !== 'object') return '';
  const sg = n => (n > 0 ? `+${n}` : `${n}`), cn = r => D.cardInfo(r).name;
  switch (f.kind) {
    case 'hp': return `${sg(f.n)} Health`;
    case 'maxHp': case 'maxhp': return `${sg(f.n)} max Health`;
    case 'flag': return f.id === 'nextHot' ? 'Your next match starts Hot 2' : f.id === 'bossExposed' ? 'This phase\'s boss starts Exposed 2' : '';
    case 'fight': return '';
    case 'coins': return `${sg(f.n)} coins`;
    case 'card': return `${cn(f.ref)} joins your deck`;
    case 'remove': return `${f.ref ? cn(f.ref) : 'A card'} leaves your deck`;
    case 'transform': return `${cn(f.from)} becomes ${cn(f.to)}`;
    case 'upgrade': return `Upgraded: ${(f.cards || []).join(', ')}`;
    case 'ability': return `New ability: ${D.abilityInfo(f.id).name}`;
    case 'stat': return `${sg(f.n)} ${STAT_LABEL[f.stat] || f.stat} for the run`;
    case 'nemesis': { const who = run?.chars?.[f.charId]?.name || 'He'; return f.what === 'helped' || f.what === 'lent' ? `${who} won't forget that you helped` : f.what === 'wronged' ? `${who} will remember this` : `${who} will remember`; }
    default: return f.text || String(f.kind || '');
  }
}
// a Mystery Stop: the text and the choices; then what happened (outcome)
export function eventHTML(run, outcome = null) {
  const e = D.eventView(run);
  const chars = (e.chars || []).map(id => run.chars?.[id]).filter(Boolean);
  const fx = (outcome?.effects || []).map(f => effectText(f, run)).filter(Boolean);
  return `<section class="gx-event">${runBarHTML(run)}<div class="gx-panel ${e.nemesis ? 'nemesis' : ''}"><div class="eyebrow">MYSTERY STOP${e.nemesis ? ' · SOMEONE YOU KNOW' : ''}</div><h2>${esc(e.title)}</h2>
    ${chars.length ? `<div class="gx-evchars">${chars.map(c => `<span><b>${esc(c.name)}</b><small>${esc(rankName(c.rank))}</small></span>`).join('')}</div>` : ''}
    <p class="gx-evtext">${esc(e.text)}</p>
    ${outcome ? `<div class="gx-outcome"><p>${esc(outcome.text)}</p>${fx.length ? `<ul class="gx-fx">${fx.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}<div class="row gap end"><button class="btn primary" data-gx="event-done">${outcome.fight ? 'Fight' : 'Continue'}</button></div></div>`
      : `<div class="gx-opts">${e.choices.map((c, i) => `<button class="gx-opt" data-choice="${i}" ${c.enabled === false ? 'disabled' : ''}><b>${esc(c.text)}</b>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`).join('')}</div>`}</div></section>`;
}
// the run's end: how far, what it paid, who changed (the nemesis world)
// fin: null while it's being sent; the server's answer { vc, vc_parts, balance, unlocks, feed, verified, ... } (a
// small Verified tick when the server replayed the run; nothing when it couldn't); { error, retry }
// when the server couldn't be reached (the run is kept: Retry); { error?, offline, feed } when it was refused or never
// issued (nothing paid). The VC shown is the server's, never the engine's estimate.
export function summaryHTML(run, over, fin = null, opts = {}) {
  const s = over?.summary || {}, ok = !!over?.completed;
  const paid = !!fin && !fin.error && !fin.offline && fin.vc != null;
  const est = typeof s.vc === 'number' ? s.vc : +s.vc?.total || 0;
  const vc = paid ? +fin.vc || 0 : 0;
  const outcomes = (s.chars || []).slice(0, 10);
  const OUT = { beat: 'You beat him', lost: 'He beat you', dodged: 'You went around him', helped: 'You helped him', wronged: 'You wronged him', lent: 'He lent you a card', betrayed: 'He turned on you', ally: 'He has your back', grudge: 'He holds a grudge' };
  const n = v => Number(v || 0).toLocaleString('en-US');
  const vcCell = paid ? `<b>+${n(vc)}</b><small>VC EARNED</small>` : fin?.retry ? `<b>…</b><small>VC NOT SENT</small>` : fin ? `<b>+0</b><small>VC</small>` : `<b>…</b><small>VC</small>`;
  let pay = '';
  if (paid) {
    const pt = fin.vc_parts || {};
    const fl = over?.summary?.final ? 1 : 0, normal = Math.max(0, (over?.matchesWon | 0) - (over?.rivals | 0) - (over?.bosses | 0) - fl);
    const rows = [[`Matches ×${normal}`, pt.matches], [`Rivals ×${over?.rivals | 0}`, pt.rivals], [`Bosses ×${over?.bosses | 0}`, pt.bosses], ['The Final', pt.final]].filter(r => r[1]);
    // (qp7 §3: no VC cap per run: the rows are what the run earned, the total what the server paid)
    pay = `<div class="gx-pay" data-pay><div class="gx-payrows">${rows.map(r => `<span>${r[0]}<b>${n(r[1])}</b></span>`).join('')}</div>
      <div class="gx-paytot"><span>Paid${fin.verified === true ? ' <em class="gx-verified" title="The server replayed this run from its choices and paid what it earned" data-verified>✓ Verified</em>' : ''}</span><b>${n(vc)} VC</b>${fin.balance != null ? `<small>Balance ${n(fin.balance)} VC</small>` : ''}</div></div>
      ${fin.repeat ? '<p class="muted small">This run was already paid: the same result.</p>' : ''}
      ${fin.unlocks ? unlocksHTML(fin.unlocks) : ''}`;
  } else if (fin?.retry) {
    pay = `<div class="gx-pay err"><p>The result couldn't be sent (${esc(fin.error || 'no connection')}). It's kept on this computer: try again and it's paid once.</p><button class="btn primary" data-gx="retry-finish">Retry</button></div>`;
  } else if (fin?.error) {
    // (a 409: the server's replay of the run's choices didn't come out as this run did; its reason as it gave it)
    pay = `<p class="lock" ${fin.replay ? 'data-replay-refused' : ''}>The server didn't pay this run: ${esc(fin.error)}</p>`;
  } else if (fin?.offline) {
    pay = `<p class="muted small">This run was played offline, so it pays no VC${est ? ` (it would have come to about ${n(est)})` : ''}. The nemesis world was updated on this computer.</p>`;
  } else if (opts.sending) {
    pay = '<p class="muted small" data-sending>Sending the result…</p>';
  }
  return `<section class="gx-summary"><div class="gx-panel"><div class="eyebrow">THE GAUNTLET · ${ok ? 'COMPLETED' : 'RUN OVER'}</div><h1>${ok ? 'Undisputed.' : over?.phaseReached > 3 ? 'So close.' : 'Not this time.'}</h1>
    <div class="stat-strip"><div><b>${over?.phaseReached > 3 ? 'Final' : `Phase ${over?.phaseReached ?? run.phase}`}</b><small>REACHED</small></div><div><b>${over?.matchesWon ?? 0}</b><small>MATCHES WON</small></div><div><b>${over?.rivals ?? 0}</b><small>RIVALS</small></div><div><b>${over?.bosses ?? 0}</b><small>BOSSES</small></div><div><b>${over?.nodesCleared ?? 0}</b><small>STOPS</small></div><div data-vc>${vcCell}</div></div>
    ${pay}
    ${outcomes.length ? `<h3>Who'll remember this run</h3><div class="gx-outs">${outcomes.map(o => `<div class="gx-out o-${esc(o.result || '')}"><b>${esc(o.name || run.chars?.[o.charId]?.name || o.charId)}</b><small>${esc(OUT[o.result] || o.result || '')}</small></div>`).join('')}</div>` : ''}
    ${(fin?.feed || []).length ? `<h3>Word on the street</h3><ul class="gx-feedl">${fin.feed.slice(0, 6).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <div class="row gap end"><button class="btn ghost" data-gx="menu">Main menu</button><button class="btn primary" data-gx="again" ${fin?.retry ? 'disabled' : ''}>Run it again</button></div></div></section>`;
}

// ---------------- qp4: the Gauntlet in possessions (scratchpad contract QP4 §1-§4) ----------------
// Building blocks for the match screen, from the engine's match state as the contract shapes it (run.match.turnType,
// turnLabel, ball, foeSet, preview); wired into the controller once the engine has them.
//   turnBannerHTML(m)   what this turn is: "Offense", "Fast break · you stole it", ...
//   foeSetHTML(set, o)  the opponent's committed set: face-up cards (name, number, animation, text) or face-down "?"
//                       with why, and the total
//   clashBarHTML(m)     "You 14 vs 9 Them" (O against D, "?" when hidden) and what it comes to; updateClash(root, m)
//                       swaps it in place as cards are played
export const TURN_LABEL = { jump_ball: 'Jump ball', offense: 'Offense', defense: 'Defense', fast_break: 'Fast break', second_chance: 'Second chance', free_throws: 'Free throws' };
// an animation tag as the three letters on a card
export const ANIM_TAG = { jumper: 'JMP', three: '3PT', layup: 'LAY', dunk: 'DNK', floater: 'FLT', post: 'PST', crossover: 'XVR', spin: 'SPN', stepback: 'STB', pass: 'PAS', lob: 'LOB', closeout: 'CLS', contest: 'CNT', block: 'BLK', steal: 'STL', rebound: 'REB', foul: 'FOU', celebrate: 'CEL', gassed: 'GAS' };
const titleCase = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
// whose turn it is on the floor: the turn type (the engine's, else from the phase and the ball) and its label
export function turnBannerHTML(m) {
  if (!m) return '';
  const type = m.turnType || (m.phase === 'jump' ? 'jump_ball' : m.ball === 'them' ? 'defense' : 'offense');
  const side = type === 'jump_ball' ? 'jump' : m.ball === 'them' ? 'them' : 'you';
  return `<div class="gx-turn tt-${esc(type)} side-${side}" data-turn><b>${esc(TURN_LABEL[type] || titleCase(type))}</b>${m.turnLabel ? `<span>${esc(m.turnLabel)}</span>` : ''}</div>`;
}
// one committed card of theirs, face up or face down
function foeCardHTML(c) {
  if (!c || c.hidden) return '<div class="gx-fcard down" title="Hidden: you can\'t read this card"><b>?</b></div>';
  const tag = ANIM_TAG[c.anim] || (c.anim ? String(c.anim).slice(0, 3).toUpperCase() : '');
  return `<div class="gx-fcard k-${esc(c.kind || 'play')}" title="${esc(c.name)}${c.text ? `: ${esc(c.text)}` : ''}">
    <span class="gx-fv">${c.value != null ? esc(c.value) : '–'}</span><span class="gx-fn">${esc(c.name)}</span>${tag ? `<i class="gx-fa">${esc(tag)}</i>` : ''}
    ${c.text ? `<small>${keywordHTML(c.text)}</small>` : ''}${(c.tags || []).length ? `<span class="gx-tags">${c.tags.map(t => `<i class="tg-${esc(String(t).toLowerCase())}">${esc(t)}</i>`).join('')}</span>` : ''}</div>`;
}
// the set they've committed this turn. o.side: what it is to them ('defense' on your offense turns, 'offense' on yours
// to defend); o.who: their name(s)
export function foeSetHTML(set, o = {}) {
  if (!set) return '';
  const side = o.side || 'defense', unit = side === 'offense' ? 'pts' : 'Stops';
  const cards = set.cards || [], total = set.total == null ? '?' : set.total;
  return `<div class="gx-foeset side-${esc(side)} ${set.hidden ? 'hidden' : ''}" data-foeset>
    <div class="gx-fs-head"><small>${esc(o.who ? `${o.who} · ` : '')}${side === 'offense' ? 'THEIR PLAY' : 'THEIR DEFENSE'}</small><b data-foe-total>${esc(total)}<em>${unit}</em></b></div>
    <div class="gx-fs-cards">${cards.length ? cards.map(foeCardHTML).join('') : '<span class="muted small">Nothing committed.</span>'}</div>
    ${set.hidden || set.why ? `<p class="gx-fs-why">${esc(set.why || 'You can\'t read their set.')}</p>` : ''}</div>`;
}
// the clash as it stands: your number against theirs (O: the offense's points, D: the defense's Stops; defense wins
// ties) and the result. m: the match (preview, ball)
export function clashBarHTML(m) {
  const pv = m?.preview;
  if (!pv) return '';
  const youOff = m.ball !== 'them', you = youOff ? pv.o : pv.d, them = youOff ? pv.d : pv.o;
  const fmt = v => (v == null ? '?' : Math.round(v));
  const known = you != null && them != null, pct = known ? Math.round(100 * Math.max(0, you) / Math.max(1, Math.max(0, you) + Math.max(0, them))) : 50;
  const res = pv.result === 'score' ? (youOff ? `You score ${pv.points | 0}` : `They score ${pv.points | 0}`) : pv.result === 'stopped' ? (youOff ? 'Stopped' : 'You stop them') : 'Can\'t tell: their set is hidden';
  return `<div class="gx-clash ${youOff ? 'off' : 'def'} r-${esc(pv.result || 'unknown')}" data-clash title="The higher number wins; defense wins ties">
    <span class="gx-cl-you"><small>YOU · ${youOff ? 'O' : 'D'}</small><b>${fmt(you)}</b></span><span class="gx-cl-vs">vs</span><span class="gx-cl-them"><b>${fmt(them)}</b><small>${youOff ? 'D' : 'O'} · THEM</small></span>
    <span class="gx-cl-bar ${known ? '' : 'unknown'}"><i style="width:${pct}%"></i></span><em class="gx-cl-res">${esc(res)}</em></div>`;
}
// the bar swapped in place (a card played: run.match.preview moved) without redrawing the table
export function updateClash(root, m) {
  const el = root?.querySelector?.('[data-clash]');
  if (!el) return false;
  const html = clashBarHTML(m);
  if (!html) { el.remove(); return true; }
  el.outerHTML = html;
  return true;
}
