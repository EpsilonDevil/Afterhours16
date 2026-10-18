// v0.4.8.5 qp8: hold to confirm (deleting a build). The confirm only goes through after one press held for the full 5
// seconds: ✕ / A (gamepad button 0), Enter or Space, or a mouse / touch press on the button. Letting go early starts it
// over from zero (the bar drains back), and a press that was already down when the screen opened doesn't count until
// it's let go and pressed again (the A or Enter that opened it can't run it). No DOM and an injected clock, so the rules
// are tested on their own (tests/v0485qp8delete.test.mjs); ui/deletebuild.js puts it on screen.
export const HOLD_MS = 5000;
export const HOLD_KEYS = ['Enter', 'NumpadEnter', 'Space'];

export class HoldGate {
  // held: the sources already down when it opened ('pad', 'key:Enter', 'pointer', ...): stale until released
  constructor({ ms = HOLD_MS, now = () => performance.now(), held = [] } = {}) {
    this.ms = ms; this.now = now;
    this.stale = new Set(held);
    this.down = new Set();
    this.t0 = null; this.done = false;
  }
  // a fresh press of one source (true when it counts)
  press(src) {
    if (this.done || this.stale.has(src) || this.down.has(src)) return false;
    this.down.add(src);
    if (this.t0 == null) this.t0 = this.now();
    return true;
  }
  // a release: with nothing else still held, back to the start (only a full, unbroken hold confirms)
  release(src) {
    this.stale.delete(src);
    if (!this.down.delete(src)) return;
    if (!this.down.size && !this.done) this.t0 = null;
  }
  // a source read once a frame (the gamepad): its state, turned into presses and releases
  set(src, isDown) { if (isDown) this.press(src); else this.release(src); }
  holding() { return this.down.size > 0; }
  progress() { return this.done ? 1 : this.t0 == null ? 0 : Math.min(1, (this.now() - this.t0) / this.ms); }
  secondsLeft() { return Math.max(0, (this.ms * (1 - this.progress())) / 1000); }
  // true once the hold has lasted the full time (and stays true: it fires once)
  tick() { if (!this.done && this.t0 != null && this.now() - this.t0 >= this.ms) this.done = true; return this.done; }
  // after a failed request: everything let go first, then a new full hold
  reset() { for (const s of this.down) this.stale.add(s); this.down.clear(); this.t0 = null; this.done = false; }
}

// what to hold on the device in use: "✕" on PlayStation, "A" on Xbox (and the bottom button on Switch), Enter / click
// and hold on a keyboard and mouse
export function holdPrompt(input, glyph) {
  if (input?.usingPad) return { pad: true, html: `Hold ${glyph(input.gp.family, 'A')} to delete`, cancel: `${glyph(input.gp.family, 'B')} Cancel` };
  return { pad: false, html: 'Hold <kbd>Enter</kbd> (or click and hold) to delete', cancel: '<kbd>Esc</kbd> Cancel' };
}
