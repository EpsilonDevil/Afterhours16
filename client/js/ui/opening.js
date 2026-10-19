// v0.4.8.6 quick patch: the opening, every time the game starts (js/brandboot.js runs it before anything else):
//  1. playStudioLogo: the Silverback Studios logo (brand/silverback-logo.svg, the studio's logo rebuilt in vector from
//     David's image, brushed silver) on black. It fades in, a gleam crosses it from left to right like the sun glaring off
//     metal, and the moment the glare reaches the right edge a deep cinematic "ding" plays (audio/title/ding.mp3: a struck
//     metal bell over a saturated sub-bass boom, in a wide stereo hall) and the logo flashes once. Then it slowly pushes in
//     as it fades to black. About 6 seconds (STUDIO).
//  2. playCutscene: the cinematic from the RIMRIFT media kit (a player's drive and dunk at a night court, the close-up at
//     the rim, then him squaring up: brand/intro-cinematic.webm, .mp4 for browsers without WebM; 15 s, silent, the
//     title song plays over it). Labeled CONCEPT CINEMATIC, as the kit asks of its concept footage.
// Then brandboot.js shows the loading screen while the game starts, then the title screen.
// Both can be skipped: a click, Enter / Space / Esc, or a fresh ✕ / A or Start press (a key or button already held when
// it shows doesn't count, as on the title screen). Each resolves {how}: 'end', 'error' (the video can't play: straight
// on), or the skip: 'pointer', 'key', 'pad' (a click or key can still go fullscreen then; a pad press can't).

// the studio logo's timeline (ms from its start)
export const STUDIO = { fadeIn: [250, 1150], gleam: [1150, 3500], flash: 3500, flashTau: 190, zoom: 0.14, fadeOut: [3950, 6100], end: 6300, skipAfter: 600 };
const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const inOut = x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
// where the logo is at ms: opacity, scale, the gleam's band (bg: the background-position % of a 250%-wide band: 100 has
// its centre a quarter-width left of the logo, 100/6 exactly on its right edge, 0 past it), the flash (0..1), the light
// streak and the halo (glare) with the gleam (0..1), lit: the metal's brightness (dim until the flash), done
export function studioFrame(ms) {
  const S = STUDIO;
  let opacity = smooth((ms - S.fadeIn[0]) / (S.fadeIn[1] - S.fadeIn[0]));
  if (ms > S.fadeOut[0]) opacity *= 1 - smooth((ms - S.fadeOut[0]) / (S.fadeOut[1] - S.fadeOut[0]));
  const scale = ms < S.flash ? 0.985 + 0.015 * smooth((ms - S.fadeIn[0]) / (S.flash - S.fadeIn[0])) : 1 + S.zoom * inOut((ms - S.flash) / (S.end - S.flash));
  const edge = 100 / 6;
  let bg = 100, streak = 0;
  if (ms >= S.gleam[0] && ms < S.flash) { const u = inOut((ms - S.gleam[0]) / (S.flash - S.gleam[0])); bg = 100 - (100 - edge) * u; streak = Math.sin(Math.PI * clamp01((ms - S.gleam[0]) / (S.flash - S.gleam[0]))) * 0.55; }
  else if (ms >= S.flash) { bg = edge * (1 - clamp01((ms - S.flash) / 260)); }
  const flash = ms < S.flash ? 0 : Math.exp(-(ms - S.flash) / S.flashTau);
  const lit = ms < S.flash ? 0.72 : 1;
  // (the glare's halo: in as the sweep starts, held all the way to the right edge, gone in the flash)
  const glare = ms < S.gleam[0] ? 0 : ms < S.flash ? smooth((ms - S.gleam[0]) / 300) : Math.max(0, 1 - (ms - S.flash) / 160);
  return { opacity, scale, bg, flash, streak, glare, lit, done: ms >= S.end };
}

// a key, click or pad press that skips (fresh presses only). Returns stop()
export function skipper(onSkip, { win = globalThis, pads = () => globalThis.navigator?.getGamepads?.() || [], raf = f => requestAnimationFrame(f), caf = id => cancelAnimationFrame(id), armed = () => true } = {}) {
  let alive = true, rafId = 0;
  const readPads = () => { let list = []; try { list = [...(pads() || [])]; } catch { /* no Gamepad API */ } return list.filter(Boolean); };
  const isDown = pad => !!(pad.buttons?.[0]?.pressed || pad.buttons?.[9]?.pressed);
  const prior = new Map();
  for (const pad of readPads()) prior.set(pad.index, isDown(pad));
  const skip = how => { if (!alive || !armed()) return false; stop(); onSkip(how); return true; };
  // (nothing of the game is under it yet: keys are only kept from scrolling the page, and still reach the title song's
  // first-key start, core/titlemusic.js arm)
  const key = e => { e.preventDefault?.(); if (['Enter', ' ', 'Escape'].includes(e.key) && !e.repeat) skip('key'); };
  const swallow = e => { e.preventDefault?.(); };
  const pointer = () => skip('pointer');
  const poll = () => {
    if (!alive) return;
    for (const pad of readPads()) { const down = isDown(pad); if (down && !prior.get(pad.index) && skip('pad')) return; prior.set(pad.index, down); }
    rafId = raf(poll);
  };
  function stop() {
    if (!alive) return; alive = false; caf(rafId);
    win.removeEventListener('keydown', key, true); win.removeEventListener('keyup', swallow, true); win.removeEventListener('pointerdown', pointer, true);
  }
  win.addEventListener('keydown', key, true); win.addEventListener('keyup', swallow, true); win.addEventListener('pointerdown', pointer, true);
  rafId = raf(poll);
  return stop;
}

function layer(doc, cls, html) {
  const root = doc.createElement('section');
  root.className = `rr-opening ${cls}`; root.setAttribute('aria-hidden', 'true');
  root.innerHTML = html;
  doc.body.append(root);
  return root;
}

// 1. the studio logo
export function playStudioLogo({ base = 'brand/', sound = null, volume = 1, doc = globalThis.document, now = () => performance.now(), raf = f => requestAnimationFrame(f), caf = id => cancelAnimationFrame(id), pads, win = globalThis, makeAudio = () => new Audio() } = {}) {
  return new Promise(resolve => {
    const logo = new URL('silverback-logo.svg', new URL(base, doc.baseURI)).href;
    const root = layer(doc, 'rr-studio', `<div class="rr-studio-stage"><img class="rr-studio-logo" alt="Silverback Studios" width="2920" height="580">
      <div class="rr-studio-glare"></div><div class="rr-studio-streak"></div><div class="rr-studio-gleam"></div><div class="rr-studio-flash"></div></div><div class="rr-studio-bloom"></div>`);
    const stage = root.querySelector('.rr-studio-stage'), gleam = root.querySelector('.rr-studio-gleam'), flash = root.querySelector('.rr-studio-flash');
    const bloom = root.querySelector('.rr-studio-bloom'), streak = root.querySelector('.rr-studio-streak'), glare = root.querySelector('.rr-studio-glare'), img = root.querySelector('.rr-studio-logo');
    root.querySelector('.rr-studio-logo').src = logo;
    for (const el of [gleam, flash]) { el.style.webkitMaskImage = el.style.maskImage = `url("${logo}")`; }
    let ding = null;
    if (sound && volume > 0) { try { ding = makeAudio(); ding.preload = 'auto'; ding.src = sound; ding.volume = Math.min(1, volume); ding.load?.(); } catch { ding = null; } }
    const t0 = now();
    let rafId = 0, dinged = false, over = false;
    const finish = how => {
      if (over) return; over = true; caf(rafId); stopSkip();
      root.remove();
      resolve({ how });
    };
    const stopSkip = skipper(how => finish(how), { win, pads, raf, caf, armed: () => now() - t0 >= STUDIO.skipAfter });
    const frame = () => {
      if (over) return;
      const ms = now() - t0, f = studioFrame(ms);
      stage.style.opacity = f.opacity.toFixed(3);
      stage.style.transform = `translate(-50%, -50%) scale(${f.scale.toFixed(4)})`;
      gleam.style.backgroundPosition = `${f.bg.toFixed(2)}% 0, ${f.bg.toFixed(2)}% 0`;
      flash.style.opacity = (f.flash * f.opacity).toFixed(3);
      bloom.style.opacity = (f.flash * 0.55).toFixed(3);
      streak.style.opacity = (f.streak * f.opacity).toFixed(3);
      streak.style.backgroundPosition = `${f.bg.toFixed(2)}% 50%`;
      glare.style.opacity = (f.glare * 0.85 * f.opacity).toFixed(3); glare.style.backgroundPosition = `${f.bg.toFixed(2)}% 0`;
      img.style.setProperty('--rr-lit', f.lit.toFixed(3)); // (the metal a little dim until the flash lights it up)
      if (!dinged && ms >= STUDIO.flash) { dinged = true; try { ding?.play?.()?.catch?.(() => {}); } catch { /* no sound */ } }
      if (f.done) { finish('end'); return; }
      rafId = raf(frame);
    };
    rafId = raf(frame);
  });
}

// 2. the cinematic
export const CUTSCENE = { sources: [['intro-cinematic.webm', 'video/webm'], ['intro-cinematic.mp4', 'video/mp4']], stall: 6000, fade: 450, skipAfter: 500, hintAfter: 1200 };
export function playCutscene({ base = 'brand/', doc = globalThis.document, now = () => performance.now(), raf = f => requestAnimationFrame(f), caf = id => cancelAnimationFrame(id), pads, win = globalThis, later = (f, ms) => setTimeout(f, ms), cancel = id => clearTimeout(id) } = {}) {
  return new Promise(resolve => {
    const url = name => new URL(name, new URL(base, doc.baseURI)).href;
    const root = layer(doc, 'rr-cutscene', `<video class="rr-cut-video" muted playsinline autoplay preload="auto" disablepictureinpicture></video>
      <div class="rr-cut-label">CONCEPT CINEMATIC</div><div class="rr-cut-skip">SKIP <b>A</b> / <b>ENTER</b></div>`);
    const video = root.querySelector('video'), hint = root.querySelector('.rr-cut-skip');
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    for (const [name, type] of CUTSCENE.sources) { const s = doc.createElement('source'); s.src = url(name); s.type = type; video.append(s); }
    const t0 = now();
    let over = false, stallId = 0, hintId = 0;
    const finish = how => {
      if (over) return; over = true; stopSkip(); cancel(stallId); cancel(hintId);
      root.classList.add('rr-out');
      later(() => { try { video.pause?.(); video.removeAttribute?.('src'); } catch { /* ignore */ } root.remove(); resolve({ how }); }, how === 'error' ? 0 : CUTSCENE.fade);
    };
    const stopSkip = skipper(how => finish(how), { win, pads, raf, caf, armed: () => now() - t0 >= CUTSCENE.skipAfter });
    video.addEventListener('ended', () => finish('end'));
    video.addEventListener('error', () => finish('error'));
    const last = [...(video.querySelectorAll?.('source') || [])].pop();
    last?.addEventListener?.('error', () => finish('error')); // (no source this browser can play)
    // (never stuck on black: nothing playing a few seconds in, it moves on)
    stallId = later(() => { if (!over && !(video.currentTime > 0)) finish('error'); }, CUTSCENE.stall);
    hintId = later(() => hint.classList.add('rr-on'), CUTSCENE.hintAfter);
    try { video.play?.()?.catch?.(() => {}); } catch { /* autoplay attribute does it */ }
  });
}
