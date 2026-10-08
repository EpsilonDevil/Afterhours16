// Per-browser presentation preferences (never authoritative game data).
const KEY = 'afterhours16.settings.v3';
const DEFAULTS = {
  quality: 'high', music: true, sfx: 0.9, crowd: 0.6, musicVol: 0.35, camera: '2k', difficulty: 0.6, tags: true, showFps: false, parkTarget: 21, quarterLen: 180, lastPark: null, character: null,
  // v0.4: controller & focus
  vibration: true, deadzone: 0.15, proStickShoot: true, invertY: false, prompts: 'auto', lockIn: true, pauseOnBlur: false,
  // v0.4.1: button remapping overrides {key: {action: code}, pad: {action: 'X'}} and the Locked-In grade HUD
  binds: { key: {}, pad: {} }, gradeHud: true,
  // v0.4.3: shot meter (off = +10% green window) and release feedback text
  shotMeter: true, shotFeedback: true,
  // v0.4.5: auto-play (H) stays on from one game to the next until you turn it off
  autoPlay: false,
};
export const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* private mode */ }
// v0.4.5: the game keeps running when you click out of the window (one-time switch for saved settings; you can
// turn pause-on-focus-loss back on in Settings)
if (!settings.v045) { settings.pauseOnBlur = false; settings.v045 = true; try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
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
