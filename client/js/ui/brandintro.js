// v0.4.8.6 RIMRIFT: the title screen, ported from the brand kit's intro (css/brandintro.css). It goes up before the game
// loads (js/brandboot.js imports main.js once it's entered) and again from Settings → Title screen. While it's up it
// has the keyboard and the focus, and everything under it is inert.
// In: a click on ENTER THE COURT; Enter, Space or Esc; ✕ / A or Start on a controller. Only a fresh press counts: a key
// held from before it showed only repeats (ignored), and a pad that's already there has its buttons read once as it
// shows, so the A that opened it from Settings has to be let go first. (A pad the browser only reveals now, when one
// of its buttons goes down, reveals it with that press: that press is new, so it counts.)
// onEnter(how) runs once, as it closes: 'pointer', 'key' or 'pad' (a click or key can still go fullscreen then, a pad
// press can't: brandboot.js). Returns dismiss.
export function mountBrandIntro({ base = 'brand/', onEnter = () => {}, pads = () => navigator.getGamepads?.() || [], raf = f => requestAnimationFrame(f), caf = id => cancelAnimationFrame(id) } = {}) {
  const existing = document.getElementById('rimrift-intro');
  if (existing) return existing.rimriftDismiss;
  const focused = document.activeElement, inertStates = new Map();
  const root = document.createElement('section');
  root.id = 'rimrift-intro'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'RIMRIFT — enter the court');
  root.innerHTML = `<div class="rr-backdrop" aria-hidden="true"></div><div class="rr-shade"></div>
    <div class="rr-top"><span>RIMRIFT</span><span>BASKETBALL SIMULATION</span></div>
    <div class="rr-content"><p class="rr-eyebrow">THE NEXT RUN STARTS HERE.</p>
    <img class="rr-logo" alt="RIMRIFT" width="1270" height="810">
    <h1>MAKE YOUR OWN<br>GRAVITY.</h1><p class="rr-intro-copy">Own the air. Find your run.</p>
    <button class="rr-enter" type="button">ENTER THE COURT <span aria-hidden="true">↗</span></button>
    <p class="rr-hint">ENTER / SPACE <span>•</span> CONTROLLER A / START</p></div>
    <div class="rr-bottom"><span>EARLY BUILD</span><span>EVERY RUN IS YOURS.</span></div>`;
  const asset = name => new URL(name, new URL(base, document.baseURI)).href;
  root.querySelector('.rr-logo').src = asset('rimrift-logo.svg');
  root.querySelector('.rr-backdrop').style.backgroundImage = `url("${asset('gravity-keyart.jpg')}")`;
  const button = root.querySelector('button');
  // (everything under it, and anything added while it's up, is inert: no clicks or focus behind it)
  const protect = node => {
    if (node === root || ['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return;
    if (!inertStates.has(node)) inertStates.set(node, node.inert);
    node.inert = true;
  };
  [...document.body.children].forEach(protect); document.body.append(root);
  const observer = new MutationObserver(records => records.forEach(r => [...r.addedNodes].filter(n => n.nodeType === 1).forEach(protect)));
  observer.observe(document.body, { childList: true });
  let alive = true, rafId = 0;
  // pads already there: their buttons as it shows (held ones don't count); pads that appear later start from "up"
  const prior = new Map();
  const readPads = () => { let list = []; try { list = [...(pads() || [])]; } catch { /* no Gamepad API */ } return list.filter(Boolean); };
  const isDown = pad => !!(pad.buttons[0]?.pressed || pad.buttons[9]?.pressed);
  for (const pad of readPads()) prior.set(pad.index, isDown(pad));
  const dismiss = (how = 'pointer') => {
    if (!alive) return; alive = false; caf(rafId); observer.disconnect();
    window.removeEventListener('keydown', keyboard, true); window.removeEventListener('keyup', swallow, true);
    button.removeEventListener('click', click); root.remove();
    for (const [node, state] of inertStates) if (node.isConnected) node.inert = state;
    if (focused?.isConnected) focused.focus?.({ preventScroll: true });
    window.dispatchEvent(new CustomEvent('rimrift:enter', { detail: { how } }));
    onEnter(how);
  };
  const click = () => dismiss('pointer');
  const swallow = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const keyboard = e => {
    swallow(e);
    if (['Enter', ' ', 'Escape'].includes(e.key) && !e.repeat) dismiss('key');
    else if (e.key === 'Tab') button.focus({ preventScroll: true });
  };
  const poll = () => {
    if (!alive) return;
    for (const pad of readPads()) {
      const down = isDown(pad);
      if (down && !prior.get(pad.index)) { dismiss('pad'); return; } // (a pad first seen now was "up" before it)
      prior.set(pad.index, down);
    }
    rafId = raf(poll);
  };
  root.rimriftDismiss = dismiss; button.addEventListener('click', click);
  window.addEventListener('keydown', keyboard, true); window.addEventListener('keyup', swallow, true);
  button.focus({ preventScroll: true }); rafId = raf(poll);
  return dismiss;
}
