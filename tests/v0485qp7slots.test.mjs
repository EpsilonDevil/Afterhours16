// v0.4.8.5 quick patch 7: ICON build slots, the client side. An account has 4 build slots and every ICON build on it opens
// one more, up to 8 (for good: the server marks the build, icon_slot). The Players tab shows the open slots and the next
// one locked, the builder says the rule instead of sending a request the server would refuse, and the game says when a
// slot opens (a toast, and the results screen). The server side: tests/test_icon_slots.py.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// (the UI modules expect a browser around them: just enough of one, and the toast element to read)
const toastEl = { textContent: '', className: '', hidden: true };
globalThis.location = { search: '', hostname: '127.0.0.1', protocol: 'http:', host: '127.0.0.1', origin: 'http://127.0.0.1', href: 'http://127.0.0.1/' };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: s => (s === '#toast' ? toastEl : null), getElementById: () => null, addEventListener() {}, documentElement: {}, body: {}, createElement: () => ({ getContext: () => null, style: {} }) };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.matchMedia = () => ({ matches: false });

const B = await import('../client/js/sim/builds.js');
const MP = await import('../client/js/ui/myplayer.js');
const BU = await import('../client/js/ui/builder.js');
const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const FULL4 = 'All 4 build slots are in use. Every ICON build on your account opens one more, up to 8.';
const FULL8 = 'All 8 build slots are in use (the most an account can have).';
let n = 0;
const build = (over = {}) => ({ id: `c${++n}`, name: `Build ${n}`, overall: 80, position: 'PF', archetype: 'stretch_big', height: 83, rep: { label: 'Rookie 1' }, icon_status: false, ...over });
const icon = (over = {}) => build({ overall: 99, icon_status: true, icon_slot: true, ...over });
const appWith = (chars, slots) => ({ profile: { characters: chars, build_slots: slots, inventory: [] }, selectedId: chars[0]?.id, config: {}, char() { return this.profile.characters.find(c => c.id === this.selectedId) || null; } });
// MyPlayer → Players, rendered into a stub root (what players() writes is in body.innerHTML)
function playersTab(app) {
  const body = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const root = { innerHTML: '', querySelector: s => (s === '#mp-body' ? body : null), querySelectorAll: () => [] };
  MP.render(app, root, { tab: 'players' });
  return body.innerHTML;
}

test('4 base slots, one more for every build holding an ICON slot, up to 8 (mirrors server/builds.py build_slots)', () => {
  assert.equal(B.BASE_BUILD_SLOTS, 4);
  assert.equal(B.MAX_BUILD_SLOTS, 8);
  assert.deepEqual(B.buildSlots([]), { unlocked: 4, base: 4, max: 8, icons: 0, kept: 0, used: 0 });
  assert.deepEqual(B.buildSlots([build(), build(), build(), build()]), { unlocked: 4, base: 4, max: 8, icons: 0, kept: 0, used: 4 });
  assert.equal(B.buildSlots([icon(), build(), build(), build()]).unlocked, 5);
  // a build that was an ICON and isn't right now (a later patch's new bar) keeps its slot: the server's mark says so
  assert.equal(B.buildSlots([build({ icon_slot: true }), build()]).unlocked, 5);
  assert.equal(B.holdsIconSlot(build({ icon_status: true })), true, 'an ICON not marked yet counts too');
  assert.equal(B.holdsIconSlot(build()), false);
  assert.deepEqual(B.buildSlots(Array.from({ length: 7 }, () => icon())), { unlocked: 8, base: 4, max: 8, icons: 7, kept: 0, used: 7 });
  // the builder's rule is the server's refusal word for word
  assert.equal(B.buildSlotRule({ unlocked: 4, max: 8 }), FULL4);
  assert.equal(B.buildSlotRule({ unlocked: 5, max: 8 }), 'All 5 build slots are in use. Every ICON build on your account opens one more, up to 8.');
  assert.equal(B.buildSlotRule({ unlocked: 8, max: 8 }), FULL8);
  const py = src('server/builds.py');
  assert.ok(py.includes('BASE_BUILD_SLOTS = 4') && py.includes('MAX_BUILD_SLOTS = 8'));
  assert.ok(py.includes('build slots are in use (the most an account can have).') && py.includes('build slots are in use. Every ICON build on your account opens one more, up to {MAX_BUILD_SLOTS}.'));
});

test('the toast when a slot opens, and app.replaceChar keeping profile.build_slots current (never taking a slot back)', () => {
  assert.equal(B.slotOpenedText({ slot: 5, max: 8, opened: 1 }), 'ICON status: your account opened build slot 5 of 8.');
  assert.equal(B.slotOpenedText({ slot: 8, max: 8, opened: 3 }), 'ICON status: your account opened build slots 6–8 of 8.');
  const chars = [build(), build(), build(), build()];
  const profile = { characters: chars, build_slots: { unlocked: 4, base: 4, max: 8, icons: 0, used: 4 } };
  assert.equal(B.refreshSlots(profile), null, 'nothing changed');
  chars[1] = { ...chars[1], overall: 99, icon_status: true, icon_slot: true }; // (an upgrade's response: now an ICON)
  assert.deepEqual(B.refreshSlots(profile), { slot: 5, max: 8, opened: 1 });
  assert.equal(profile.build_slots.unlocked, 5);
  assert.equal(B.refreshSlots(profile), null, 'said once');
  chars[1] = { ...chars[1], icon_status: false, icon_slot: false }; // (even a build that came back without its mark)
  assert.equal(B.refreshSlots(profile), null);
  assert.equal(profile.build_slots.unlocked, 5, 'a slot is never taken back');
  // with no server word yet (an older profile) it starts counting quietly
  const p2 = { characters: [icon()] };
  assert.equal(B.refreshSlots(p2), null);
  assert.equal(p2.build_slots.unlocked, 5);
  // main.js: every build that comes back goes through replaceChar, which says it (after the action's own toast), and
  // so does the profile load that opened slots
  const main = src('client/js/main.js');
  assert.match(main, /app\.replaceChar = c => \{[\s\S]*?const up = refreshSlots\(p\);\s*if \(up\) setTimeout\(\(\) => toast\(slotOpenedText\(up\), 'good'\), 1600\);/);
  assert.match(main, /const opened = app\.profile\?\.build_slot_unlocked;\s*if \(opened\) setTimeout\(\(\) => toast\(slotOpenedText\(opened\), 'good'\)/);
  // the results screen: the same note where Icon badge unlocks show (qp8: and 30 seconds before it moves on, not 10:
  // tests/v0485qp8results.test.mjs)
  const modes = src('client/js/ui/modes.js');
  assert.match(modes, /const slotUp = r\?\.build_slot_unlocked;/);
  assert.match(modes, /if \(hof \|\| slotUp\) card\.querySelector\('\.results \.row\.end'\)[\s\S]*?\$\{slotNote\}<\/div>`\);/);
  assert.match(modes, /const news = !!\(hof \|\| slotUp\);/);
});

test('MyPlayer → Players reads app.profile.build_slots: create while under the cap, the line, the next slot locked', () => {
  const four = [build(), build(), build(), build()];
  let html = playersTab(appWith(four, { unlocked: 4, base: 4, max: 8, icons: 0, used: 4 }));
  assert.ok(!html.includes('+ Create new player'), 'all 4 in use');
  assert.ok(html.includes('Build slots: 4 of 8 open — 4 base. Every ICON build opens one more, up to 8.'), html);
  assert.ok(html.includes('Slot 5 · locked') && html.includes('Make a build an ICON'));
  assert.ok(!/four players/i.test(html));
  // one ICON: slot 5 is open, slot 6 shows locked
  const withIcon = [icon(), build(), build(), build()];
  html = playersTab(appWith(withIcon, { unlocked: 5, base: 4, max: 8, icons: 1, used: 4 }));
  assert.ok(html.includes('+ Create new player'));
  assert.ok(html.includes('Build slots: 5 of 8 open — 4 base + 1 ICON. Every ICON build opens one more, up to 8.'), html);
  assert.ok(html.includes('Slot 6 · locked') && html.includes('Make another build an ICON'));
  assert.equal((html.match(/class="player-card locked"/g) || []).length, 1, 'one locked placeholder');
  // 8: no create, no locked slot
  const eight = [icon(), icon(), icon(), icon(), build(), build(), build(), build()];
  html = playersTab(appWith(eight, { unlocked: 8, base: 4, max: 8, icons: 4, used: 8 }));
  assert.ok(!html.includes('+ Create new player') && !html.includes('locked'));
  assert.ok(html.includes('Build slots: 8 of 8 open — 4 base + 4 ICONs. That&#39;s the most an account can have.'), html);
  html = playersTab(appWith([icon(), icon(), icon(), icon(), icon(), icon(), build()], { unlocked: 8, base: 4, max: 8, icons: 6, used: 7 }));
  assert.ok(html.includes('+ Create new player') && html.includes('4 base + 4 from your 6 ICON builds'));
  // no build_slots from the server (an older one): counted from the builds
  html = playersTab(appWith([icon(), build(), build(), build()], undefined));
  assert.ok(html.includes('Build slots: 5 of 8 open') && html.includes('+ Create new player'));
  assert.ok(!/Up to four/.test(src('client/js/ui/myplayer.js')));
});

test('the builder: at the cap, Create shows the rule instead of sending a request the server would refuse', async () => {
  const four = [build(), build(), build(), build()];
  assert.equal(BU.slotsFull(appWith(four.slice(0, 3), { unlocked: 4, base: 4, max: 8, icons: 0, used: 3 })), null);
  assert.equal(BU.slotsFull(appWith([], undefined)), null, 'the first build');
  assert.equal(BU.slotsFull(appWith(four, { unlocked: 4, base: 4, max: 8, icons: 0, used: 4 })).unlocked, 4);
  assert.equal(BU.slotsFull(appWith([icon(), ...four.slice(1)], { unlocked: 5, base: 4, max: 8, icons: 1, used: 4 })), null);
  // the Create button on a full account: the rule in a toast, no request
  const els = new Map();
  const el = s => { if (!els.has(s)) els.set(s, { dataset: {}, set onclick(f) { this._click = f; }, get onclick() { return this._click; } }); return els.get(s); };
  const root = { innerHTML: '', querySelector: el, querySelectorAll: () => [] };
  let sent = 0;
  const app = { ...appWith(four, { unlocked: 4, base: 4, max: 8, icons: 0, used: 4 }), api: { mutate: async () => { sent++; return {}; } },
    config: { skin: ['#a56945'], faces: ['oval'], hair: ['fade'], hair_colors: ['#201b19'], beards: ['stubble'], eyes: ['#3a2418'], default_equipment: {} },
    showroom: { setCharacter() {}, setFocus() {} }, look: () => ({}) };
  BU.create(app, root);
  assert.ok(root.innerHTML.includes(FULL4), 'the rule shows next to the button');
  assert.ok(root.innerHTML.includes('data-create data-full'));
  await el('[data-create]').onclick({ currentTarget: el('[data-create]') });
  assert.equal(sent, 0, 'no doomed request');
  assert.equal(toastEl.textContent, FULL4);
  assert.match(toastEl.className, /error/);
  // with a slot open it sends
  app.profile.build_slots = { unlocked: 5, base: 4, max: 8, icons: 1, used: 4 };
  app.profile.characters[0] = icon();
  app.replaceChar = () => {};
  await el('[data-create]').onclick({ currentTarget: el('[data-create]') });
  assert.equal(sent, 1);
});
