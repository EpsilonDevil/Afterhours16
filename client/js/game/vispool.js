// v0.4.5 stage 7: people at the park without the hitches.
//
// Building one athlete (meshes + painted face/jersey/shorts/hair + GPU upload) costs tens of milliseconds, and
// the park used to build them in the middle of a frame whenever a background game rotated (a full court is six
// new athletes), a group of park-goers walked in, or a game's losers walked off. On a 60 Hz screen that showed up
// as a hitch or a short freeze, worst at the King Tut Cup where three full courts rotate all night.
//
// The pool fixes both halves of that:
//  * reuse: when a walker steps onto a court, or a background game's players walk off, the athlete they were
//    already wearing is handed over instead of being thrown away and built again (same body + look + detail);
//  * staged builds: anybody new is built a step at a time inside a small per-frame budget (see AthleteView.staged)
//    and shows up when ready, a few frames later, instead of stalling the frame.
import { AthleteView } from '../char/view.js';

// the things an athlete's meshes and textures are made from
export function visualKey(build, look, opts = {}) {
  return JSON.stringify([build?.height, build?.weight, build?.wingspan, look || null, opts.detail ?? 1, opts.faceRes || 0]);
}

export class VisualPool {
  constructor(renderer, { maxFree = 24, budgetMs = 3 } = {}) {
    this.r = renderer;
    this.maxFree = maxFree;
    this.budgetMs = budgetMs;
    this.free = new Map(); // key -> [AthleteView] (built, not in the scene)
    this.lru = [];         // free views, oldest first
    this.queue = [];       // staged builds, first come first served
    this.stats = { hits: 0, builds: 0, evicted: 0 };
  }
  get pending() { return this.queue.length; }

  take(key) {
    const list = this.free.get(key);
    if (!list || !list.length) return null;
    const v = list.pop();
    if (!list.length) this.free.delete(key);
    const i = this.lru.indexOf(v);
    if (i >= 0) this.lru.splice(i, 1);
    this.stats.hits++;
    return v;
  }

  release(key, view) {
    view.removeFrom();
    view.setVisible(true);
    view._poolKey = key;
    let list = this.free.get(key);
    if (!list) this.free.set(key, list = []);
    list.push(view);
    this.lru.push(view);
    while (this.lru.length > this.maxFree) {
      const old = this.lru.shift(), l = this.free.get(old._poolKey);
      if (l) { l.splice(l.indexOf(old), 1); if (!l.length) this.free.delete(old._poolKey); }
      old.dispose();
      this.stats.evicted++;
    }
  }

  // queue a staged build; done(view) runs from tick() once it's finished
  // (urgent: ahead of everything that hasn't started yet)
  request(key, build, look, opts, done, urgent = false) {
    const { view, steps } = AthleteView.staged(this.r, build, look, opts);
    const job = { key, view, steps, done, started: false, cancelled: false };
    if (urgent) { let i = 0; while (i < this.queue.length && this.queue[i].started) i++; this.queue.splice(i, 0, job); }
    else this.queue.push(job);
    return job;
  }
  // build these into the pool ahead of time (unless one's already free); resolves when they're all ready
  prebuild(list) {
    return new Promise(resolve => {
      let left = 1;
      const done = () => { if (--left === 0) resolve(); };
      for (const { build, look, opts } of list) {
        const key = visualKey(build, look, opts);
        if (this.free.get(key)?.length) continue;
        left++;
        this.request(key, build, look, opts, v => { this.release(key, v); done(); }, true);
      }
      done();
    });
  }
  // nobody needs it any more: unstarted builds are dropped, half-built ones finish into the pool (whoever it was
  // is likely to show up again)
  cancel(job) { if (job) job.cancelled = true; }

  // build for up to budgetMs this frame (at least one step, so a long queue always moves)
  tick(budgetMs = this.budgetMs) {
    const t0 = performance.now();
    while (this.queue.length) {
      const j = this.queue[0];
      if (j.cancelled && !j.started) { this.queue.shift(); continue; }
      j.started = true;
      if (j.steps.next().done) {
        this.queue.shift();
        this.stats.builds++;
        if (j.cancelled) this.release(j.key, j.view); else j.done(j.view);
      }
      if (performance.now() - t0 >= budgetMs) break;
    }
  }
  // finish everything now (loading screens, where a frame or two doesn't matter)
  flush() { this.tick(Infinity); }

  dispose() {
    for (const j of this.queue) if (j.started) j.view.dispose();
    this.queue = [];
    for (const v of this.lru) v.dispose();
    this.free.clear();
    this.lru = [];
  }
}
