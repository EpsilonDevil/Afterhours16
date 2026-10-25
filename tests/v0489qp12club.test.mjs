// v0.4.8.9 qp12: the club in the Pro-Am menu (ui/proam.js): AI members on the roster (an AI tag, online or offline, the
// founder's Remove), the Invite button and the one invite dialog the HUB's offices call too (openInviteDialog: AI friends
// join at once, players get an invite, the invites out), the invites waiting for you (join or decline), and the queue's
// lineup (the AI members the HUB shows and the AI squad mates go before the draft). A stand-in DOM and service; the real
// service: tests/test_v0489qp12_proam_club.py.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';

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

const realSI = globalThis.setInterval;
globalThis.setInterval = (f, ms, ...a) => { const h = realSI(f, ms, ...a); h.unref?.(); return h; }; // (the season countdown's ticks don't hold the test open)
const P = await import('../client/js/ui/proam.js');
const U = await import('../client/js/ui/proamui.js');
const C = await import('../client/js/ui/common.js');

const SEASON = { n: 1, start: 1792636763, end: Date.now() / 1000 + 44 * 86400 };
const RULES = { max_members: 10, logos: ['bolt'], parks: [], refreshes: 3, queue_wait: 45, series_bonus: [1500, 3000, 5000], boost: [0], tiers: [] };
const div = { index: 0, tier: 0, label: 'Bronze 1', div: 1 };
function service() {
  const s = { calls: [], invites: [{ team: { id: 't7', name: 'Night Owls', abbr: 'NO', size: 3, division: div }, from: 'cal', at: 1 }] };
  s.team = { id: 't1', name: 'Night Shift', abbr: 'NS', primary: '#c8322f', secondary: '#111111', founder: 'me', division: div, rp: 0, record: [0, 0], series: [0, 0], open: true,
    members: [{ kind: 'player', account_id: 'me', username: 'me', founder: true, build: { name: 'Kaua Lima', state: { ...div, rp: 0 } } },
      { kind: 'ai', ai_id: 'ai-7', name: 'Dre Banks', build: { position: 'C', overall: 81 }, online: true }],
    invites_sent: [{ account_id: 'acc-zed', username: 'zed', from: 'me', at: 2 }], ai_games: [] };
  const status = () => ({ me: 'me', season: SEASON, team: s.team, given: [], builds: [], requested: [], invites: s.invites, rules: RULES });
  s.api = {
    get: async path => { s.calls.push(['GET', path]); if (path === '/api/proam') return status(); throw new Error('unexpected GET ' + path); },
    post: async (path, body) => {
      s.calls.push(['POST', path, body]);
      if (path === '/api/proam/invite') { if (body.to.kind === 'ai') s.team.members.push({ kind: 'ai', ai_id: body.to.ai_id, name: body.to.name, build: body.to.build, online: false }); return { result: body.to.kind === 'ai' ? 'joined' : 'invited' }; }
      if (path === '/api/proam/uninvite') { s.team.invites_sent = []; return { ok: true }; }
      if (path === '/api/proam/remove') { s.team.members = s.team.members.filter(m => m.ai_id !== body.ai_id); return { ok: true }; }
      if (path === '/api/proam/accept_invite' || path === '/api/proam/decline_invite') { s.invites = []; return { result: path.endsWith('accept_invite') ? 'joined' : 'declined' }; }
      if (path === '/api/proam/queue') return body.action === 'leave' ? { state: 'left' } : { state: 'matched', game: { n: 1, home: true, opponent: { kind: 'ai', id: 'ai_hbv', name: 'Harborview Gulls', abbr: 'HBV', div: 0 }, venue: 'proam_rooftop', result: null }, series: { id: 'sr1', div: 0, team_id: 't1' } };
      if (path === '/api/proam/lineup') return { ai: [...(body.ai_members || []), ...body.squad, 'ai-90'].slice(0, 5 - body.humans), humans: body.humans, members: body.ai_members || [], squad: body.squad, draft: ['ai-90'] };
      throw new Error('unexpected POST ' + path);
    },
    mutate: async (path, body) => { s.calls.push(['MUTATE', path, body]); s.ticket = body; throw new Error('(the test stops at the ticket)'); },
  };
  return s;
}
const ENT = { 'ai-7': ['Dre Banks', 'C', 81], 'ai-8': ['Lou Fields', 'PG', 74], 'ai-9': ['Sal Ortiz', 'SF', 68] };
const appFor = svc => ({ api: svc.api, profile: { account: { id: 'me' } }, catalog: {}, net: null, char: () => ({ id: 'c1', name: 'Kaua Lima' }),
  ai: { friends: ['ai-7', 'ai-8', 'ai-9'], online: id => id === 'ai-8', activeSquad: () => ['ai-9'],
    entry: id => (ENT[id] ? { name: ENT[id][0], build: { position: ENT[id][1], overall: ENT[id][2] }, look: { skin: 2 } } : null) } });
const screen = () => { ui.innerHTML = ''; const r = new El('div'); ui.append(r); return r; };
const flush = () => new Promise(r => realST(r, 30));

test('the roster: AI members with an AI tag and their schedule, the founder removes them; the Invite button; the invites waiting', async () => {
  const svc = service(), app = appFor(svc), root = screen();
  await P.render(app, root);
  const rows = root.querySelectorAll('.pa-members tbody tr');
  assert.equal(rows.length, 2);
  assert.match(rows[1].textContent, /Dre Banks.*AI.*81 C.*Online/s);
  assert.ok(root.querySelector('[data-invite]'), 'Invite');
  assert.match(root.querySelector('[data-invite]').textContent, /2\/10/);
  // the invites waiting for you: on a team already, Join waits until you leave; Decline works
  assert.match(root.querySelector('.pa-invites').textContent, /Night Owls.*cal invited you/s);
  assert.ok(root.querySelector('[data-acceptinv="t7"]').disabled);
  root.querySelector('[data-declineinv="t7"]').click(); await flush();
  assert.deepEqual(svc.calls.find(c => c[1] === '/api/proam/decline_invite')[2], { team_id: 't7' });
  // the founder removes an AI member
  C.closeModal();
  root.querySelector('[data-removeai="ai-7"]').click(); await flush();
  document.querySelector('#modal [data-ok], #modal .btn.primary')?.click(); await flush();
  assert.deepEqual(svc.calls.find(c => c[1] === '/api/proam/remove')?.[2], { ai_id: 'ai-7' });
});

test('the invite dialog: AI friends join at once, players get an invite, the invites out; the HUB calls the same one', async () => {
  const svc = service(), app = appFor(svc);
  assert.equal(U.openInviteDialog, P.openInviteDialog, 'proamui re-exports it for the HUB');
  const card = await P.openInviteDialog(app, null);
  const body = () => card.querySelector('.pa-inv-body').textContent;
  assert.match(body(), /Lou Fields.*online/s);
  assert.doesNotMatch(body(), /Dre Banks/, 'not the ones in the club already');
  card.querySelector('[data-invai="ai-8"]').click(); await flush();
  const sent = svc.calls.find(c => c[1] === '/api/proam/invite')[2];
  assert.deepEqual(sent, { team_id: 't1', to: { kind: 'ai', ai_id: 'ai-8', name: 'Lou Fields', build: { position: 'PG', archetype: undefined, overall: 74, height: undefined, weight: undefined, wingspan: undefined }, look: { skin: 2 } } });
  assert.doesNotMatch(body(), /Lou Fields/, 'he joined: off the list');
  // players: offline, a username on this game
  card.querySelector('[data-invtab="players"]').click();
  assert.match(body(), /Offline: invite a player/);
  card.querySelector('[data-invname]').value = 'bea';
  card.querySelector('[data-invname-go]').click(); await flush();
  assert.deepEqual(svc.calls.filter(c => c[1] === '/api/proam/invite')[1][2], { team_id: 't1', to: { kind: 'player', username: 'bea' } });
  // the invites out: take one back
  card.querySelector('[data-invtab="sent"]').click();
  assert.match(body(), /zed.*waiting/s);
  card.querySelector('[data-uninv="acc-zed"]').click(); await flush();
  assert.deepEqual(svc.calls.find(c => c[1] === '/api/proam/uninvite')[2], { account_id: 'acc-zed' });
  assert.match(body(), /No invites out/);
});

test('online, the players tab lists your friends who are on and the people here', async () => {
  const svc = service(), app = appFor(svc);
  app.net = { connected: true, myId: 'me', friends: [{ id: 'f1', username: 'fran', status: 'friends', presence: { online: true } }, { id: 'f2', username: 'gus', status: 'friends', presence: { online: false } }],
    people: new Map([['p1', { username: 'pat' }], ['me', { username: 'me' }]]), hub: null, offline: false };
  const card = await P.openInviteDialog(app, null, { tab: 'players' });
  const t = card.querySelector('.pa-inv-body').textContent;
  assert.match(t, /fran.*friend, online/s); assert.match(t, /pat.*here now/s); assert.doesNotMatch(t, /gus/);
});

test('the lineup: the AI members the HUB shows and the AI squad mates go before the draft', async () => {
  const svc = service(), app = appFor(svc);
  await P.queue(app, null, { aiMembers: ['ai-7'] }); await flush();
  const lu = svc.calls.find(c => c[1] === '/api/proam/lineup')[2];
  assert.deepEqual(lu, { humans: 1, squad: ['ai-9'], ai_members: ['ai-7'] }, 'offline: your own squad');
  assert.deepEqual(app.paLineup, { ai: ['ai-7', 'ai-9', 'ai-90'], humans: 1, members: ['ai-7'], squad: ['ai-9'], draft: ['ai-90'] });
  assert.match(String(svc.ticket?.pa_game?.series || ''), /sr1/, 'then the game');
  const svc2 = service(), app2 = appFor(svc2);
  await P.queue(app2, null, {}); await flush();
  assert.equal('ai_members' in svc2.calls.find(c => c[1] === '/api/proam/lineup')[2], false, 'without the HUB: the server takes the AI members on by their schedule');
});

test('the shared names stay where the HUB looks for them', () => {
  for (const k of ['openInviteDialog', 'memberRow', 'invitesBlock', 'answerInvite']) assert.equal(typeof P[k], 'function', k);
  assert.match(P.memberRow({ kind: 'ai', ai_id: 'ai-1', name: 'X', online: false }, true), /AI.*Offline.*data-removeai="ai-1"/s);
  assert.doesNotMatch(P.memberRow({ kind: 'ai', ai_id: 'ai-1', name: 'X', online: true }, false), /data-removeai/);
});
