// v0.4.7.5 qp3: the online socket. One WebSocket to the game service (/api/ws, server/online.py) carries your real
// friends' presence, invites, rooms and, during an online game, everyone's input (see MatchSession.frameOnline).
// It reconnects on its own; the game's messages are held until the game is ready to take them (attachGame).
// Two ways in: the game the host's PC serves (join.cmd: same origin, the sign-in cookie), or your own copy of the game
// linked to a friend's hosted one (configure({ hub, token, build })): the socket goes to his PC and signs in on itself
// with a token, or your online account there (login / register), and his service checks the game's build first.
export class Net {
  constructor() {
    this.ws = null; this.on_ = new Map();
    this.state = 'off';          // off | connecting | on
    this.want = false;           // keep connected (signed in)
    this.you = null; this.friends = []; this.room = null; this.entries = {};
    this.rtt = null; this.retry = 0; this.lastWhere = '';
    this.gameNo = 0; this.gameFn = null; this.inbox = []; this.early = [];
    this.sentEntryFor = null;
    this.entryFn = null;         // () => your player entry for the room (ui/online.js)
    this.hub = null; this.token = null; this.build = null; // (qp3: a friend's hosted game, from your own copy)
    this.authError = null;       // {code: version | token | auth | rate, text}
  }
  // your own copy, playing online through a friend's hosted game ('host:port'); null = this page's own service
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
    try { ws = new WebSocket(this.hub ? `ws://${this.hub}/api/ws` : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`); }
    catch { this.later(); return; }
    this.ws = ws; this.state = 'connecting'; this.emit('state');
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.state = 'on'; this.retry = 0; this.lastWhere = ''; this.sentEntryFor = null; this.you = null;
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
      this.ws = null; this.state = 'off'; this.room = null; this.entries = {}; this.you = null;
      if (this.gameFn) this.gameFn({ t: 'closed' }); else this.inbox.push({ t: 'closed' });
      this.emit('state'); this.emit('room');
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
      case 'in': case 'left': case 'hash':
        // (an input for a game we haven't been told about yet waits for its start)
        if (m.t === 'in' && m.g > this.gameNo) { this.early.push(m); return; }
        if (m.t === 'in' && m.g !== this.gameNo) return;
        if (this.gameFn) this.gameFn(m); else this.inbox.push(m);
        return;
      case 'hello': this.you = m.you; this.friends = m.friends || []; this.emit('friends'); this.emit('state'); return;
      case 'authed': this.token = m.token; this.authError = null; this.emit('authed', m); return;
      case 'autherror':
        this.authError = { code: m.code, text: m.text };
        if (m.code === 'token') this.token = null;
        if (m.code === 'version') this.want = false; // (no point coming back until the game is updated)
        this.emit('autherror', m); this.emit('state');
        return;
      case 'friends': this.friends = m.friends || []; this.emit('friends'); return;
      case 'room': {
        this.room = m.room;
        if (!m.room) this.entries = {};
        // (into a new room: the others get to see your player, and the host can set the game up with him)
        if (m.room && this.sentEntryFor !== m.room.id && this.entryFn) { this.sentEntryFor = m.room.id; this.sendEntry(); }
        this.emit('room');
        return;
      }
      case 'need-entry': this.sendEntry(); return;
      case 'entries': this.entries = m.entries || {}; this.emit('entries'); return;
      case 'start': {
        const s = m.setup || {};
        this.gameNo = s.game | 0; this.gameFn = null;
        this.inbox = this.early.filter(x => x.g === this.gameNo); this.early = this.early.filter(x => x.g > this.gameNo);
        this.emit('start', s);
        return;
      }
      case 'pong': {
        // the round trip to the service: the second best of the last 8 (a busy frame can hold a reply up; the
        // network itself is what the input delay has to cover)
        if (typeof m.c !== 'number') return;
        (this.rtts || (this.rtts = [])).push(performance.now() - m.c);
        if (this.rtts.length > 8) this.rtts.shift();
        const s = [...this.rtts].sort((a, b) => a - b);
        this.rtt = s[Math.min(1, s.length - 1)];
        if (this.room) this.send({ t: 'rtt', ms: Math.round(this.rtt) });
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
  // the running game takes its messages (and any that came in before it was ready); returns a detach function
  attachGame(gameNo, fn) {
    const wrap = m => { if (m.t !== 'in' || m.g === gameNo) fn(m); };
    this.gameFn = wrap;
    const held = this.inbox; this.inbox = [];
    for (const m of held) wrap(m);
    return () => { if (this.gameFn === wrap) this.gameFn = null; };
  }
  inRoom() { return !!this.room; }
  isHost() { return !!this.room && !!this.you && this.room.host === this.you.id; }
}
