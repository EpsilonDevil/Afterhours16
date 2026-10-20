// v0.4.7.5 qp3: the online socket. One WebSocket to the hosting game's service (/api/ws, server/online.py) carries
// your real friends' presence; the people at the same park (or Crew HQ) as you, where they walk and the Got Next
// claims and kings on its courts; your squad, Pro-Am challenges and your online crew; and the games themselves: your
// own (everyone's input, in lockstep: MatchSession.frameOnline) and the ones you watch from the sideline.
// It reconnects on its own; a game's messages are held until the game is ready to take them (attachGame / attachWatch).
// Two ways in: the game the host's PC serves (join.cmd: same origin, the sign-in cookie), or your own copy of the game
// linked to a friend's hosted one (configure({ hub, token, build })): the socket goes to his PC and signs in on itself
// with a token, or your online account there (login / register), and his service checks the game's build first.
// the socket of a friend's hosted game ('host:port', plain) or an online server with HTTPS ('https://host[:port]': wss)
export const hubSocketUrl = hub => (/^https:\/\//i.test(hub) ? `wss://${hub.slice(8)}` : `ws://${hub}`) + '/api/ws';

export class Net {
  constructor() {
    this.ws = null; this.on_ = new Map();
    this.state = 'off';          // off | connecting | on
    this.want = false;           // keep connected (signed in)
    this.you = null; this.friends = [];
    this.rtt = null; this.retry = 0; this.lastWhere = '';
    this.gameNo = 0; this.gameFn = null; this.inbox = []; this.early = [];
    this.entryFn = null;         // () => your player entry (ui/online.js)
    this.hub = null; this.token = null; this.build = null; // (qp3: a friend's hosted game, from your own copy)
    this.authError = null;       // {code: version | token | auth | rate, text}
    // where you are: the people there (id -> {id, username, name, entry}), its courts' claims / kings / games in use
    this.place = null; this.people = new Map(); this.courts = {}; this.placeGames = [];
    this.squad = null; this.squadEntries = {}; this.squadAI = {}; // (squadAI: each member's AI squad mates, from his own game)
    this.crew = null;
    this.watchFns = new Map(); this.watchBox = new Map(); // game id -> fn / held messages (games you watch)
  }
  // your own copy, playing online through a friend's hosted game ('host:port') or an online server ('https://host');
  // null = this page's own service
  configure({ hub = null, token = null, build = null } = {}) { this.hub = hub; this.token = token; this.build = build; this.authError = null; }
  get remote() { return !!this.hub; }
  // (from your own copy, before the token: the sign-in form sends one of these on the open socket)
  login(username, password) { this.authError = null; return this.send({ t: 'login', username, password, build: this.build }); }
  register(username, password, joinCode) { this.authError = null; return this.send({ t: 'register', username, password, join_code: joinCode, build: this.build }); }
  start() { if (this.want) return; this.want = true; this.open(); }
  stop() { this.want = false; clearTimeout(this.reT); clearInterval(this.pingT); if (this.ws) try { this.ws.close(); } catch { /* closing */ } }
  get connected() { return this.state === 'on' && !!this.you; } // (open and signed in)
  get signingIn() { return this.state === 'on' && !this.you; }

  open() {
    if (!this.want || (this.ws && this.ws.readyState <= 1)) return;
    let ws;
    try { ws = new WebSocket(this.hub ? hubSocketUrl(this.hub) : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`); }
    catch { this.later(); return; }
    this.ws = ws; this.state = 'connecting'; this.emit('state');
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.state = 'on'; this.retry = 0; this.lastWhere = ''; this.you = null;
      if (this.hub) this.send({ t: 'hi', build: this.build }); // (the host checks the game's version straight away)
      if (this.hub && this.token) this.send({ t: 'auth', token: this.token, build: this.build });
      clearInterval(this.pingT);
      this.pingT = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
      this.send({ t: 'ping', c: performance.now() });
      this.emit('state');
    };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m && typeof m === 'object') this.receive(m); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingT);
      this.ws = null; this.state = 'off'; this.you = null;
      this.place = null; this.people = new Map(); this.courts = {}; this.placeGames = []; this.squad = null; this.crew = null;
      if (this.gameFn) this.gameFn({ t: 'closed' }); else this.inbox.push({ t: 'closed' });
      for (const fn of this.watchFns.values()) fn({ t: 'closed' });
      this.emit('state'); this.emit('people'); this.emit('courts'); this.emit('squad'); this.emit('crew');
      this.later();
    };
    ws.onerror = () => {};
  }
  later() { if (!this.want) return; clearTimeout(this.reT); this.reT = setTimeout(() => this.open(), Math.min(15000, 1000 * 2 ** Math.min(4, this.retry++))); }

  send(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }
  on(type, fn) { if (!this.on_.has(type)) this.on_.set(type, new Set()); this.on_.get(type).add(fn); return () => this.on_.get(type)?.delete(fn); }
  emit(type, m) { for (const fn of [...(this.on_.get(type) || [])]) { try { fn(m); } catch (e) { console.error(e); } } }

  receive(m) {
    switch (m.t) {
      case 'in': case 'inw': case 'left': case 'hash': {
        // your game's (held until it's ready; an input for a game you haven't been told about yet waits for its start)
        // (qp3 perf: 'in' is a player's inputs for a few ticks; 'inw' a bundle of everyone's, for the people watching)
        const g = m.g;
        if (m.t === 'hash' || g === this.gameNo || (g == null && m.t === 'left')) { if (this.gameFn) this.gameFn(m); else this.inbox.push(m); return; }
        if ((m.t === 'in' || m.t === 'inw') && g > this.gameNo && !this.watchFns.has(g) && !this.watchBox.has(g)) { this.early.push(m); if (this.early.length > 4000) this.early.shift(); return; }
        // a game you're watching
        const fn = this.watchFns.get(g);
        if (fn) fn(m); else { const box = this.watchBox.get(g) || []; box.push(m); if (box.length < 50000) this.watchBox.set(g, box); }
        return;
      }
      case 'hello':
        this.you = m.you; this.friends = m.friends || [];
        this.sendEntry();
        if (m.world) this.emit('world', m); // (v0.4.8.7: the service's one AI world: sim/world.js adoptSharedWorld)
        this.emit('friends'); this.emit('state'); return;
      case 'authed': this.token = m.token; this.authError = null; this.emit('authed', m); return;
      case 'autherror':
        this.authError = { code: m.code, text: m.text };
        if (m.code === 'token') this.token = null;
        if (m.code === 'version') this.want = false; // (no point coming back until the game is updated)
        this.emit('autherror', m); this.emit('state');
        return;
      case 'friends': this.friends = m.friends || []; this.emit('friends'); return;
      // ---- the place you're at ----
      case 'here':
        this.place = m.place; this.people = new Map((m.players || []).map(p => [p.id, p])); this.courts = m.courts || {}; this.placeGames = m.games || [];
        this.emit('people'); this.emit('courts'); return;
      case 'pentry': if (m.id) { this.people.set(m.id, { id: m.id, username: m.username, name: m.name, entry: m.entry, rtt: m.rtt, ai: m.ai || [] }); this.emit('people', m); } return;
      case 'gone': this.people.delete(m.id); this.emit('people', m); this.emit('gone', m); return;
      case 'courts': if (m.place === this.place) { this.courts = m.courts || {}; this.emit('courts'); } return;
      case 'courtscore': {
        const ct = this.courts[String(m.court)];
        if (ct?.busy) ct.busy.score = m.score;
        this.emit('courtscore', m); return;
      }
      // ---- your squad, your crew ----
      case 'squad': this.squad = m.squad; if (!m.squad) { this.squadEntries = {}; this.squadAI = {}; } this.emit('squad'); return;
      case 'squad-entries': this.squadEntries = m.entries || {}; this.squadAI = m.ai || {}; this.emit('squad'); return;
      case 'crew': this.crew = m.crew; this.emit('crew'); return;
      // ---- games ----
      case 'start': {
        const s = m.setup || {};
        this.gameNo = s.game | 0; this.gameFn = null;
        this.watchBox.delete(this.gameNo); this.watchFns.delete(this.gameNo);
        this.inbox = this.early.filter(x => x.g === this.gameNo); this.early = this.early.filter(x => x.g > this.gameNo);
        this.emit('start', s);
        return;
      }
      case 'watch': {
        const g = m.setup?.game;
        if (g == null || g === this.gameNo) return;
        // (inputs that came before the watch, and the game so far when you arrived late)
        const held = [...(Array.isArray(m.log) ? [{ t: 'inw', g, m: m.log }] : []), ...this.early.filter(x => x.g === g), ...(this.watchBox.get(g) || [])];
        this.early = this.early.filter(x => x.g !== g);
        this.watchBox.set(g, held);
        this.emit('watch', m.setup);
        return;
      }
      case 'watchend': this.emit('watchend', m); return;
      case 'pong': {
        // the round trip to the service: the second best of the last 8 (a busy frame can hold a reply up; the
        // network itself is what the input delay has to cover)
        if (typeof m.c !== 'number') return;
        (this.rtts || (this.rtts = [])).push(performance.now() - m.c);
        if (this.rtts.length > 8) this.rtts.shift();
        const s = [...this.rtts].sort((a, b) => a - b);
        this.rtt = s[Math.min(1, s.length - 1)];
        // (v0.4.8.7: the service's clock against this PC's, from the replies with the quickest round trips: the shared AI
        // world runs on it)
        if (typeof m.s === 'number') {
          const rt = performance.now() - m.c, k = m.s + rt / 2 - Date.now();
          (this.skews || (this.skews = [])).push([rt, k]);
          if (this.skews.length > 8) this.skews.shift();
          const best = [...this.skews].sort((a, b) => a[0] - b[0]).slice(0, 3).map(x => x[1]).sort((a, b) => a - b);
          this.serverSkew = best[Math.floor(best.length / 2)];
          this.emit('clock', this.serverSkew);
        }
        return;
      }
      // (qp3 perf: someone's round trip changed: the people here and your squad set up games with it)
      case 'rtt': {
        const p = this.people.get(m.id), sm = this.squad?.members?.find(x => x.id === m.id);
        if (p) p.rtt = m.rtt;
        if (sm) sm.rtt = m.rtt;
        return;
      }
      case 'replaced': this.want = false; this.emit('note', { text: 'You signed in somewhere else: online play moved there.' }); return;
      default: this.emit(m.t, m);
    }
  }
  sendEntry() { const e = this.entryFn && this.entryFn(); if (e) this.send({ t: 'entry', entry: e }); }
  // presence: your name, where you are and what you're doing (sent when it changes)
  where(info) {
    const k = JSON.stringify(info);
    if (k === this.lastWhere || !this.connected) return;
    if (this.send({ t: 'where', ...info })) this.lastWhere = k;
  }
  // the game you play takes its messages (and any that came in before it was ready); returns a detach function
  attachGame(gameNo, fn) {
    const wrap = m => { if (m.t !== 'in' || m.g === gameNo) fn(m); };
    this.gameFn = wrap;
    const held = this.inbox; this.inbox = [];
    for (const m of held) wrap(m);
    return () => { if (this.gameFn === wrap) this.gameFn = null; };
  }
  // a game you watch from the sideline (the same messages, without the right to send any)
  attachWatch(g, fn) {
    this.watchFns.set(g, fn);
    const held = this.watchBox.get(g) || []; this.watchBox.delete(g);
    for (const m of held) fn(m);
    return () => { if (this.watchFns.get(g) === fn) this.watchFns.delete(g); };
  }
  // ---- you and your squad ----
  get myId() { return this.you?.id || null; }
  squadLeader() { return this.squad ? this.squad.leader : this.myId; }
  isLeader() { return !this.squad || this.squad.leader === this.myId; }
  // squad mates with you right now at this place and free to play (not you)
  squadHere() { return (this.squad?.members || []).filter(m => m.id !== this.myId && m.park === this.place && !m.inGame); }
  entryOf(id) { return this.people.get(id)?.entry || this.squadEntries[id] || null; }
  // the AI squad mates a player brought from his own game: [{id, name, entry}] (they run in his online squad too)
  aiOf(id) { const p = this.people.get(id); return (p?.ai?.length ? p.ai : this.squadAI[id]) || []; }
  usernameOf(id) { return this.people.get(id)?.username || this.squad?.members.find(m => m.id === id)?.username || this.friends.find(f => f.id === id)?.username || '?'; }
  court(ci) { return this.courts[String(ci)] || null; }
}
