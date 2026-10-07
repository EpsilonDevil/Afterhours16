// v0.4.1 "Locked-In" grade: a running teammate grade for the user's player (top-right HUD), in the spirit
// of the teammate grade every NBA 2K game has. Starts at C+, moves with smart and costly plays, and has
// diminishing returns near the ends so one big play can't swing it from F to A+.
export const GRADES = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
const START = 6; // C+
const LIM = 6.4;

export class LockedInGrade {
  constructor(game, meId) {
    this.g = game;
    this.me = meId;
    this.v = 0;
    this.pop = null; // {text, good, t}
    this.rel = new Map(); // shooter id -> {contest, grade, closest}
    this.holdT = 0;
    this.version = 0;
    this.counts = { good: 0, bad: 0 };
  }

  get index() { return Math.max(0, Math.min(GRADES.length - 1, Math.round(START + this.v))); }
  get letter() { return GRADES[this.index]; }
  // progress toward the next letter, 0..1
  get progress() { const x = START + this.v + 0.5; return Math.max(0, Math.min(1, x - Math.floor(x))); }
  get tier() { const i = this.index; return i >= 10 ? 'a' : i >= 7 ? 'b' : i >= 4 ? 'c' : i >= 1 ? 'd' : 'f'; }

  add(delta, text) {
    const k = delta > 0 ? 1 - Math.max(0, this.v) / (LIM + 1.6) : 1 - Math.max(0, -this.v) / (LIM + 1.6);
    this.v = Math.max(-LIM, Math.min(LIM, this.v + delta * k));
    this.pop = { text: `${delta > 0 ? '+' : '−'} ${text}`, good: delta > 0, t: 2.2 };
    this.counts[delta > 0 ? 'good' : 'bad']++;
    this.version++;
  }

  onEvent(e) {
    const g = this.g, me = g.players[this.me];
    if (!me || g.practice && e.type !== 'release' && e.type !== 'score' && e.type !== 'miss') return;
    const mine = e.player === this.me;
    const P = e.player != null ? g.players[e.player] : null;
    switch (e.type) {
      case 'release': {
        // remember the look the shooter got, and who was guarding him
        let closest = null, cd = 9;
        if (P) for (const d of g.opponents(P)) { const dd = Math.hypot(d.x - P.x, d.z - P.z); if (dd < cd) { cd = dd; closest = d; } }
        let manOf = null;
        try { manOf = P && P.team !== me.team && g.ai ? g.ai.manOf(me) : null; } catch { manOf = null; }
        this.rel.set(e.player, { contest: e.contest || 0, grade: e.grade, closest: closest && closest.id, cd, myMan: manOf && manOf.id === e.player, myDist: P ? Math.hypot(me.x - P.x, me.z - P.z) : 9 });
        break;
      }
      case 'score': {
        if (e.ft) { if (mine) this.add(0.06, 'Free throw'); break; }
        const r = this.rel.get(e.player) || {};
        if (mine) {
          let d = 0.45 + (e.three ? 0.12 : 0) + (r.grade === 'excellent' ? 0.15 : 0);
          if (e.kind === 'dunk') d += 0.05;
          this.add(d, r.grade === 'excellent' ? 'Green release' : e.three ? 'Made three' : e.kind === 'dunk' ? 'Dunk' : 'Bucket');
        } else if (P && P.team !== me.team) {
          if (r.closest === this.me && (r.contest || 0) < 0.3) this.add(-0.45, 'Gave up an open shot');
          else if (r.myMan && (r.contest || 0) < 0.3 && r.myDist > 2.8) this.add(-0.55, 'Left your man open');
        }
        break;
      }
      case 'miss': {
        const r = this.rel.get(e.player) || {};
        if (mine) {
          if (r.grade === 'vearly' || r.grade === 'vlate') this.add(-0.35, 'Bad shot timing');
          else if ((r.contest || 0) > 0.8) this.add(-0.4, 'Forced a contested shot');
          else if ((r.contest || 0) < 0.35) this.add(-0.1, 'Missed open shot');
          else this.add(-0.2, 'Missed shot');
        } else if (P && P.team !== me.team && r.closest === this.me && (r.contest || 0) > 0.55) this.add(0.35, 'Good contest');
        break;
      }
      case 'assist': if (mine) this.add(0.6, 'Assist'); break;
      case 'rebound': if (mine) this.add(e.offensive ? 0.4 : 0.3, e.offensive ? 'Offensive rebound' : 'Defensive rebound'); break;
      case 'steal':
        if (mine) this.add(0.6, e.intercept ? 'Interception' : 'Steal');
        else if (e.victim === this.me) this.add(-0.8, e.intercept ? 'Pass picked off' : 'Turnover');
        break;
      case 'turnover': if (mine) this.add(-0.7, 'Turnover'); break;
      case 'block':
        if (mine) this.add(0.55, 'Block');
        else if (e.shooter === this.me) this.add(-0.15, 'Got blocked');
        break;
      case 'foul': if (mine) this.add(e.shooting ? -0.35 : -0.2, e.shooting ? 'Shooting foul' : 'Foul'); break;
      case 'ankle':
        if (mine) this.add(0.3, 'Ankle breaker');
        else if (e.victim === this.me) this.add(-0.3, 'Got crossed up');
        break;
      case 'slam': if (e.poster === this.me) this.add(-0.2, 'Posterized'); break;
      case 'screen': if (mine) this.add(0.12, 'Screen'); break;
      case 'pass': if (mine) this.holdT = 0; break;
    }
  }

  // per sim step: holding the ball too long without making a play
  tick(dt) {
    const g = this.g, me = g.players[this.me];
    if (this.pop) { this.pop.t -= dt; if (this.pop.t <= 0) { this.pop = null; this.version++; } }
    if (!me || g.practice || g.phase !== 'live') { this.holdT = 0; return; }
    if (g.ball.holder === this.me && g.mates(me).length) {
      this.holdT += dt;
      if (this.holdT > 9) { this.add(-0.3, 'Ball hog'); this.holdT = 3; }
    } else this.holdT = 0;
  }

  result() { return { letter: this.letter, tier: this.tier, value: +this.v.toFixed(2), good: this.counts.good, bad: this.counts.bad }; }
}
