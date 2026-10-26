// v0.4.8.9 qp15: how often the main loop runs (main.js loop).
// The game used to draw every frame the browser offered, foreground or background: RIMRIFT.exe opens the game with
// background throttling turned off (so an online game keeps its lockstep when you click out of the window), which also
// meant a park of about a million triangles kept drawing at the monitor's full refresh behind whatever else you were
// doing, and the whole PC dragged. Now:
//  * In the background (the window doesn't have the focus, or it's hidden) the game runs at a trickle: 30 frames a
//    second while a game is on (it keeps playing, and an online game keeps everyone in step), 10 in the menus and the
//    park. Settings → In the background: "Full speed" turns this off.
//  * In front, frames are capped at the Frame rate limit (60 by default; 30, 120, 144 or the display's own rate).
// The pacer keeps the average on the cap on any refresh rate (a 144 Hz display at a 60 cap runs alternate gaps of two
// and three refreshes), and a frame that comes late never makes the next ones bunch up.
export const FPS_CAPS = [[0, 'Match the display'], [30, '30 FPS'], [60, '60 FPS'], [120, '120 FPS'], [144, '144 FPS']];
export const BG_LIVE_FPS = 30, BG_IDLE_FPS = 10; // (10: a frame of 0.1 s, the longest step the loop and the games take, so game time keeps real time)

// the frame rate to run at now (0: every frame the browser gives)
export function targetFps({ background = false, live = false, bgMode = 'save', cap = 60 } = {}) {
  if (background && bgMode !== 'full') return live ? BG_LIVE_FPS : BG_IDLE_FPS;
  const c = +cap || 0;
  return c > 0 ? c : 0;
}

export class Pacer {
  constructor() { this.next = 0; this.fps = null; }
  // is the frame at `now` (ms, the rAF timestamp) one to run at `fps`?
  due(now, fps) {
    if (fps !== this.fps) { this.fps = fps; this.next = 0; } // (a new rate starts now: back in front, no wait for the old slow beat)
    if (!fps) return true;
    const iv = 1000 / fps;
    if (now < this.next - 1) return false; // (a millisecond early still counts: rAF times jitter)
    this.next = (now - this.next > iv ? now : this.next) + iv;
    return true;
  }
}
