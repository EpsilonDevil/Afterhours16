// Per-browser presentation preferences (never authoritative game data).
// v0.4.8.6 RIMRIFT: saved under the game's new name. The settings saved before the rename are copied over the first
// time (the old entry is left as it was): nobody's controls, volumes or camera change with the name
export const SETTINGS_KEY = 'rimrift.settings.v3', OLD_SETTINGS_KEY = 'afterhours16.settings.v3';
const KEY = SETTINGS_KEY;
const DEFAULTS = {
  quality: 'high', music: true, sfx: 0.95, crowd: 0.8, musicVol: 0.65, camera: '2k', difficulty: 0.6, tags: true, showFps: false, parkTarget: 21, quarterLen: 180, lastPark: null, character: null,
  // v0.4: controller & focus
  vibration: true, deadzone: 0.15, proStickShoot: true, invertY: false, prompts: 'auto', lockIn: true, pauseOnBlur: false,
  // v0.4.1: button remapping overrides {key: {action: code}, pad: {action: 'X'}} and the Locked-In grade HUD
  binds: { key: {}, pad: {} }, gradeHud: true,
  // v0.4.3: shot meter (off = +10% green window) and release feedback text
  shotMeter: true, shotFeedback: true,
  // v0.4.7.5 qp3: shot feedback (grade and how guarded) over everyone's releases, not only yours
  shotFeedbackAll: false,
  // v0.4.5: auto-play (H) stays on from one game to the next until you turn it off
  autoPlay: false,
  // v0.4.7.5: green release sounds and effects: 'all' players, 'mine' only, or 'off'
  greens: 'all',
  // v0.4.7.5 quick patch: the defensive assignment arrows (you and the man you should be guarding)
  defArrows: true,
  // v0.4.7.5 qp3 perf: an online game whose frames run slow draws a little lighter until they're quick again
  adaptiveGfx: true,
};
export const settings = { ...DEFAULTS };
try {
  let saved = localStorage.getItem(KEY);
  if (saved == null && (saved = localStorage.getItem(OLD_SETTINGS_KEY)) != null) try { localStorage.setItem(KEY, saved); } catch { /* full: read again next time */ }
  Object.assign(settings, JSON.parse(saved || '{}'));
} catch { /* private mode */ }
// v0.4.5: the game keeps running when you click out of the window (one-time switch for saved settings; you can
// turn pause-on-focus-loss back on in Settings)
if (!settings.v045) { settings.pauseOnBlur = false; settings.v045 = true; try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
// v0.4.7.5 qp3: the volume sliders are perceptual. A slider at s plays at gain s^VOLUME_CURVE: the steps near the
// bottom are much bigger than they were (5 on the slider is 0.1% of full, 25 is 4%, 50 is 18%, 75 is 53%), so the
// quietest setting before silence is quiet, and a notch at the top still does something
export const VOLUME_CURVE = 2.4;
export const volumeGain = s => (s <= 0 ? 0 : Math.pow(Math.min(1, s), VOLUME_CURVE));
// (saved sliders from before the curve are moved so they play at the same loudness they did: v → v^(1/curve))
if (!settings.v0475qp3vol) { for (const k of ['sfx', 'crowd', 'musicVol']) if (typeof settings[k] === 'number') settings[k] = Math.round(Math.pow(Math.max(0, Math.min(1, settings[k])), 1 / VOLUME_CURVE) * 20) / 20; settings.v0475qp3vol = true; try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
export function autoQuality(renderer) {
  // pick a starting preset from the GPU description when the user hasn't chosen one
  try {
    const gl = renderer.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
    if (/intel|uhd|iris|mali|adreno|apple m1/i.test(name)) return 'medium';
    return 'high';
  } catch { return 'medium'; }
}
