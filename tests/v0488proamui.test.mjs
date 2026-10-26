// v0.4.8.8 The Pro-Am Overhaul, the game's side (ui/proam.js, ui/modes.js proamGame): the Pro-Am tab (the first visit's
// create or join, the team page with its season countdown), the office panels the hub calls (openOffice: whiteboard,
// draft clipboard, team settings) and the queue (queue: the ready check, the matchmaker's answer, then the game, whose
// ticket carries the series game). Run against a stand-in DOM and a stand-in service (the real one:
// tests/test_v0488_proam.py).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---------------- a small stand-in DOM ----------------
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'source', 'wbr', 'col', 'link']);
const ROOTS = new Set();
class El {
  constructor(tag, attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.kids = []; this.parent = null; this.text = ''; this.scrollTop = 0; this.scrollLeft = 0; this.style = {}; this.disabled = 'disabled' in this.attrs; this.value = this.attrs.value ?? ''; this.checked = 'checked' in this.attrs; }
  get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
  get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
  get dataset() { const d = {}; for (const k in this.attrs) if (k.startsWith('data-')) d[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = this.attrs[k]; return d; }
  get classList() { const me = this, l = () => me.className.split(/\s+/).filter(Boolean); return { contains: c => l().includes(c), add: c => { me.className = [...new Set([...l(), c])].join(' '); }, remove: c => { me.className = l().filter(x => x !== c).join(' '); }, toggle(c, on) { if (on ?? !l().includes(c)) this.add(c); else this.remove(c); } }; }
  get parentElement() { return this.parent; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return ROOTS.has(n); }
  get children() { return this.kids; } get firstElementChild() { return this.kids[0] || null; }
  set innerHTML(h) { for (const k of this.kids) k.parent = null; this.kids = []; this.text = ''; parse(String(h), this); }
  get innerHTML() { return ''; }
  set textContent(t) { for (const k of this.kids) k.parent = null; this.kids = []; this.text = String(t); }
  get textContent() { return this.text + this.kids.map(k => k.textContent).join(' '); }
  get innerText() { return this.textContent; }
  append(...ns) { for (const n of ns) { n.parent = this; this.kids.push(n); } } appendChild(n) { this.append(n); return n; }
  remove() { if (this.parent) { this.parent.kids.splice(this.parent.kids.indexOf(this), 1); this.parent = null; } }
  all() { const out = []; const w = n => { for (const k of n.kids) { out.push(k); w(k); } }; w(this); return out; }
  querySelectorAll(s) { return s === '*' ? this.all() : this.all().filter(n => matches(n, s)); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  closest(s) { for (let n = this; n; n = n.parent) if (matches(n, s)) return n; return null; }
  click() { if (!this.disabled) return this.onclick?.({ currentTarget: this, target: this, stopPropagation() {}, preventDefault() {} }); }
  focus() {} addEventListener() {} removeEventListener() {}
}
const TOK = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
function parse(h, into) {
  const stack = [into];
  for (const m of h.matchAll(TOK)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { const i = stack.map(n => n.tagName).lastIndexOf(m[1].toUpperCase()); if (i > 0) stack.length = i; continue; }
    if (m[2]) { const a = {}; for (const x of (m[3] || '').matchAll(ATTR)) a[x[1]] = x[2] ?? x[3] ?? x[4] ?? ''; const el = new El(m[2], a); if (m[2] === 'select') el.value = ''; top.append(el); if (m[2] === 'option' && 'selected' in a) top.value = a.value; if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el); continue; }
    top.text += m[0];
  }
}
const PART = /([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
const one = (n, s) => [...s.matchAll(PART)].every(m => !((m[1] && m[1] !== '*' && n.tagName !== m[1].toUpperCase()) || (m[2] && n.id !== m[2]) || (m[3] && !n.classList.contains(m[3])) || (m[4] && (!(m[4] in n.attrs) || (m[5] != null && n.attrs[m[4]] !== m[5])))));
const matches = (n, sel) => sel.split(',').some(s => { const ch = s.trim().split(/\s+/); if (!one(n, ch.at(-1))) return false; let i = ch.length - 2; for (let p = n.parent; p && i >= 0; p = p.parent) if (one(p, ch[i])) i--; return i < 0; });

const html = new El('html'), body = new El('body'); ROOTS.add(html); html.append(body);
const ui = new El('div', { id: 'ui' }), modalEl = new El('div', { id: 'modal' }), toastEl = new El('div', { id: 'toast' });
body.append(ui, modalEl, toastEl);
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.document = { documentElement: html, scrollingElement: html, body, querySelector: s => html.querySelector(s), querySelectorAll: s => html.querySelectorAll(s), getElementById: id => html.querySelector('#' + id), createElement: t => new El(t), addEventListener() {}, removeEventListener() {} };
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = () => 0;
const realST = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realST(f, Math.min(ms, 5), ...a); // (the queue's 2 s polls, at once)

const P = await import('../client/js/ui/proam.js');
const C = await import('../client/js/ui/common.js');

// ---------------- a stand-in service ----------------
const SEASON = { n: 1, start: 1792636763, end: Date.now() / 1000 + 44 * 86400 + 3 * 3600 + 1800 };
const RULES = { max_members: 10, logos: ['bolt', 'crown', 'star'], parks: P.PARKS.map(p => p[0]), refreshes: 3, queue_wait: 45, series_bonus: [1500, 3000, 5000], boost: [0, 0.02, 0.04, 0.05], tiers: [] };
const div = (i, label = 'Bronze 1') => ({ index: i, tier: 0, label, div: 1 });
function service() {
  const s = { calls: [], team: null, pool: ['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5', 'ai-6', 'ai-7', 'ai-8'], list: ['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5'], refreshes: 0, picks: {}, polls: 0 };
  const status = () => ({ season: SEASON, team: s.team, given: [], builds: [{ id: 'c1', name: 'Kaua Lima', pa: { ...div(0), rp: 0, series: [0, 0], record: [0, 0] }, history: { rank: 'Gold', games: 12 } }], requested: [], rules: RULES });
  const draft = () => ({ pool: s.pool, list: s.list, refreshes_left: 3 - s.refreshes, picks: s.picks });
  const series = { id: 'sr1', length: 3, need: 2, wins: 0, losses: 0, games: [], division: div(0), refreshes_left: 3 };
  const game = { n: 1, home: true, opponent: { kind: 'ai', id: 'ai_hbv', name: 'Harborview Gulls', abbr: 'HBV', div: 0 }, venue: 'proam_rooftop', result: null };
  s.api = {
    get: async path => {
      s.calls.push(['GET', path]);
      if (path === '/api/proam') return status();
      if (path.startsWith('/api/proam/search')) return { teams: [{ id: 'ai_hbv', name: 'Harborview Gulls', abbr: 'HBV', ai: true, division: div(0), record: [0, 0], series: [0, 0], size: 7, open: false }, { id: 't9', name: 'Night Owls', abbr: 'NO', ai: false, division: div(1, 'Bronze 2'), record: [3, 1], series: [1, 0], size: 4, open: true }] };
      if (path.startsWith('/api/proam/teams')) return { team: { id: 'ai_hbv', name: 'Harborview Gulls', abbr: 'HBV', ai: true, division: div(0), roster: ['ai-11', 'ai-12', 'ai-13', 'ai-14', 'ai-15'], record: [0, 0], series: [0, 0] } };
      throw new Error('unexpected GET ' + path);
    },
    post: async (path, body) => {
      s.calls.push(['POST', path, body]);
      if (path === '/api/proam/create') { s.team = { id: 't1', name: body.team.name, abbr: body.team.abbr, primary: body.team.primary, secondary: body.team.secondary, logo: body.team.logo, court: body.team.court, open: body.team.open, founder: 'me', division: div(0), rp: 0, record: [0, 0], series: [0, 0], members: [{ account_id: 'me', username: 'me', founder: true, build: { name: 'Kaua Lima', state: { ...div(0), rp: 0 } } }], series_on: null }; return { team: s.team }; }
      if (path === '/api/proam/join') return { result: 'joined' };
      if (path === '/api/proam/draft') {
        if (body.action === 'list') s.list = body.ids;
        if (body.action === 'refresh') { s.refreshes++; s.pool = s.pool.map(x => x + 'r'); s.list = s.pool.slice(0, 5); }
        if (body.action === 'pick') s.picks[String(Object.keys(s.picks).length + 1)] = body.ai_id;
        return { draft: draft() };
      }
      if (path === '/api/proam/update') { Object.assign(s.team, body.team); return { team: s.team }; }
      if (path === '/api/proam/queue') {
        if (body.action === 'leave') return { state: 'left' };
        if (body.action === 'join' || s.polls++ < 1) return { state: 'waiting', left: 40 };
        return { state: 'matched', game, series };
      }
      if (path === '/api/proam/lineup') return { ai: ['ai-1', 'ai-2', 'ai-3', 'ai-4'].slice(0, 5 - body.humans) };
      throw new Error('unexpected POST ' + path);
    },
    mutate: async (path, body) => { s.calls.push(['MUTATE', path, body]); if (path === '/api/matches') { s.ticket = body; throw new Error('(the test stops at the ticket)'); } throw new Error(path); },
  };
  return s;
}
const POS = { 'ai-1': 'PG', 'ai-2': 'PG', 'ai-3': 'SG', 'ai-4': 'SF', 'ai-5': 'SF', 'ai-6': 'PF', 'ai-7': 'C', 'ai-8': 'C' };
const appFor = svc => ({ api: svc.api, profile: { account: { id: 'me' } }, catalog: {}, net: null,
  ai: { entry: id => ({ name: 'Player ' + id, build: { position: POS[id] || 'SF', overall: 70 } }) } });
const screen = () => { ui.innerHTML = ''; const r = new El('div'); ui.append(r); return r; };
const flush = () => new Promise(r => realST(r, 30));

test('the small pieces: the season line, the countdown, the parks, a spread of positions', () => {
  assert.equal(P.countdown(44 * 86400 + 3 * 3600 + 59), '44d 3h');
  assert.equal(P.countdown(3 * 3600 + 120), '3h 2m');
  assert.equal(P.countdown(59), '0m');
  assert.match(P.seasonLine({ n: 2, end: 1796446800 }, 1796446800 - 86400 * 2), /^Season 2 · ends .+ \(2d 0h\)$/);
  assert.equal(P.PARKS.length, 12);
  assert.equal(P.parkName('rooftop'), 'Rooftop'); assert.equal(P.venueName('proam_cage'), 'The Cage'); assert.equal(P.parkName(null), 'A different park every home game');
  // one of each position in the pool's order first, then the rest in order
  assert.deepEqual(P.spreadPick(['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5', 'ai-6', 'ai-7', 'ai-8'], id => POS[id]), ['ai-1', 'ai-3', 'ai-4', 'ai-6', 'ai-7']);
  assert.deepEqual(P.spreadPick(['ai-1', 'ai-2', 'ai-5'], id => POS[id]), ['ai-1', 'ai-5', 'ai-2']);
});

test('the first visit: create a team or join one; creating it lands on the team page with the season and the office', async () => {
  const svc = service(), app = appFor(svc), root = screen();
  await P.render(app, root);
  assert.ok(root.querySelector('[data-go="create"]') && root.querySelector('[data-go="join"]'));
  assert.match(root.querySelector('.pa-season').textContent, /^Season 1 · ends .* \(44d 3h\)$/);
  assert.match(root.textContent, /before Season 1: Gold/);
  root.querySelector('[data-go="create"]').click();
  root.querySelector('[data-f="name"]').value = 'Night Shift'; root.querySelector('[data-f="abbr"]').value = 'ns';
  root.querySelector('[data-pick="logo"] [data-val="crown"]').click();
  root.querySelector('[data-pick="jersey"] [data-val="split"]').click();
  // (qp14: the create form's picks take now: they never did, only the settings panel bound them)
  assert.deepEqual(P.readSettings(root), { name: 'Night Shift', abbr: 'ns', primary: '#2457c5', secondary: '#f2c14e', logo: 'crown', jersey: 'split', court: null, open: true });
  await root.querySelector('[data-create]').click(); await flush();
  const created = svc.calls.find(c => c[1] === '/api/proam/create');
  assert.equal(created[2].team.name, 'Night Shift');
  assert.ok(root.querySelector('.pa-team'), `the team page (${toastEl.textContent})`);
  for (const k of ['whiteboard', 'draft', 'settings']) assert.ok(root.querySelector(`[data-office="${k}"]`), k);
  assert.ok(root.querySelector('[data-queue]'));
});

test('join: every team on the server, real and AI; an AI team can only be looked at', async () => {
  const svc = service(), app = appFor(svc), root = screen();
  await P.render(app, root);
  root.querySelector('[data-go="join"]').click(); await flush();
  const rows = root.querySelectorAll('.pa-results .pa-row');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].querySelector('[data-viewteam]') && !rows[0].querySelector('[data-join]'), 'an AI team: View');
  assert.ok(rows[1].querySelector('[data-join="t9"]'), 'a real open team: Join');
  await rows[1].querySelector('[data-join]').click(); await flush();
  assert.deepEqual(svc.calls.find(c => c[1] === '/api/proam/join')[2], { team_id: 't9' });
});

test('the office: the whiteboard, the draft clipboard (five with a spread of positions, 3 refreshes) and the founder\'s settings', async () => {
  const svc = service(), app = appFor(svc);
  svc.team = { id: 't1', name: 'Night Shift', abbr: 'NS', primary: '#123456', secondary: '#abcdef', logo: 'bolt', court: 'rooftop', open: true, founder: 'me', division: div(0), rp: 20, record: [1, 1], series: [0, 0],
    members: [{ account_id: 'me', username: 'me', founder: true, build: { name: 'Kaua', state: { ...div(0), rp: 20 } } }, { account_id: 'u2', username: 'ben', founder: false, build: null }],
    current: { id: 'sr1', length: 3, need: 2, wins: 1, losses: 0, division: div(0), refreshes_left: 3, games: [{ n: 1, home: true, opponent: { kind: 'ai', name: 'Harborview Gulls' }, venue: 'proam_rooftop', result: 'W', score: [60, 50] }] } };
  await P.openOffice(app, null, 'whiteboard');
  const wb = modalEl.querySelector('.pa-board');
  assert.match(wb.textContent, /Bronze 1 series · 1-0/); assert.match(wb.textContent, /Harborview Gulls/); assert.match(wb.textContent, /Rooftop/); assert.match(wb.textContent, /Game 3/);
  C.closeModal();
  await P.openOffice(app, null, 'draft');
  const listed = svc.calls.find(c => c[1] === '/api/proam/draft' && c[2].action === 'list');
  assert.deepEqual(listed[2].ids, ['ai-1', 'ai-3', 'ai-4', 'ai-6', 'ai-7'], 'the captain\'s game sends five with a spread of positions');
  const draftEl = modalEl.querySelector('.pa-draft');
  assert.equal(draftEl.querySelectorAll('.pa-clip .pa-row').length, 5);
  assert.match(draftEl.textContent, /3 refreshes left/);
  await draftEl.querySelector('[data-pick="ai-3"]').click(); await flush();
  assert.deepEqual(svc.picks, { 1: 'ai-3' });
  await modalEl.querySelector('[data-refresh]').click(); await flush();
  assert.equal(svc.refreshes, 1);
  C.closeModal();
  // not the captain: no picking
  await P.openOffice(app, null, 'draft', { captain: false });
  assert.equal(modalEl.querySelectorAll('[data-pick]').length, 0);
  C.closeModal();
  await P.openOffice(app, null, 'settings');
  assert.equal(modalEl.querySelector('[data-f="name"]').value, 'Night Shift');
  assert.ok(modalEl.querySelector('[data-kick="u2"]') && modalEl.querySelector('[data-handon="u2"]'));
  modalEl.querySelector('[data-f="name"]').value = 'Night Shift II';
  await modalEl.querySelector('[data-save]').click(); await flush();
  assert.equal(svc.calls.find(c => c[1] === '/api/proam/update')[2].team.name, 'Night Shift II');
  // someone else's: the founder's alone
  app.profile.account.id = 'u2';
  const before = svc.calls.length;
  await P.openOffice(app, null, 'settings');
  assert.equal(svc.calls.filter(c => c[1] === '/api/proam/update').length, 1);
  assert.ok(svc.calls.length > before);
});

test('the queue: the matchmaker (waiting, then a game), the lineup, then the game, its ticket for the series game at the home court', async () => {
  const svc = service(), app = appFor(svc);
  svc.team = { id: 't1', name: 'Night Shift', abbr: 'NS', primary: '#123456', secondary: '#abcdef', founder: 'me', division: div(0), rp: 0, record: [0, 0], series: [0, 0], members: [{ account_id: 'me', username: 'me', founder: true }] };
  app.char = () => ({ id: 'c1', name: 'Kaua Lima' });
  await P.queue(app, svc.team);
  await flush(); await flush();
  const q = svc.calls.filter(c => c[1] === '/api/proam/queue').map(c => c[2].action);
  assert.deepEqual(q.slice(0, 3), ['join', 'poll', 'poll']);
  assert.deepEqual(svc.calls.find(c => c[1] === '/api/proam/lineup')[2], { humans: 1, squad: [] }); // (qp12: and the AI squad mates who came: none here)
  // proamGame took it from there: the ticket (the test stops there)
  assert.deepEqual(svc.ticket.pa_game, { series: 'sr1', n: 1 });
  assert.equal(svc.ticket.mode, 'proam');
  assert.equal(svc.ticket.format, 5);
  assert.ok(svc.ticket.venue === 'proam_rooftop' || svc.ticket.venue === 'arena', svc.ticket.venue);
  assert.equal(svc.ticket.opp_rating, 37);
});

test('the shared contracts are where the hub and the World agent look for them', () => {
  const m = src('client/js/ui/modes.js');
  assert.match(m, /export async function proamGame\(app, ctx = \{\}\)/);
  assert.match(m, /const \{ team, opponent, series, game, lineup = \[\], members = null \} = ctx;/);
  assert.match(m, /pa_game: P\.paTicketGame\(app, series, game, team\)/); // (qp6: online, the ticket carries the team's service's game)
  assert.match(m, /\.\.\.\(myPa \? \{ pa_game: myPa \} : \{\}\)/, 'an online team game: every member\'s ticket (v0.4.8.8 real vs real: his own team\'s)');
  assert.match(src('client/js/ui/proam.js'), /export async function openOffice\(app, team, panel = 'whiteboard', opts = \{\}\)/);
  assert.match(src('client/js/ui/proam.js'), /export async function queue\(app, team, opts = \{\}\)/);
  assert.match(src('client/js/ui/screens.js'), /case 'proam': return params\.classic \? Modes\.proam\(app, root, params\) : import\('\.\/proam\.js'\)/);
  // the ready check over the online service
  assert.match(src('server/online.py'), /elif t == "pa-ready":/);
  assert.match(src('client/js/ui/online.js'), /net\.on\('pa-ready', m => paReadyMsg\(app, m\)\);/);
});
