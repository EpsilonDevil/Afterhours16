// v0.4.8.6 RIMRIFT, the identity finished: the browser keeps everything it saved under the old name (settings,
// the shader log, the soundtrack's recent tracks, the ICON Squad windows already announced), the scripts and their
// windows say RIMRIFT, and their own folders move over. (The save, the server's settings and the bug-report file:
// tests/test_v0486_rename.py; the online server's command: tests/test_deploy.py.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let fresh = 0;
const storage = (init = {}, { full = false } = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); m.set(k, String(v)); }, removeItem: k => m.delete(k) };
};
// a first start of the page with this browser storage (a fresh copy of the module each time)
async function startWith(store) {
  globalThis.localStorage = store;
  return import(`../client/js/core/settings.js?start=${++fresh}`);
}
const OLD = 'afterhours16.settings.v3', NEW = 'rimrift.settings.v3';
const mine = { camera: 'broadcast', sfx: 0.4, deadzone: 0.22, binds: { key: { shoot: 'KeyJ' }, pad: {} }, v045: true, v0475qp3vol: true };

test('settings saved before the rename are copied to the new key once, and kept as they were', async () => {
  const store = storage({ [OLD]: JSON.stringify(mine) });
  const { settings, SETTINGS_KEY, OLD_SETTINGS_KEY } = await startWith(store);
  assert.equal(SETTINGS_KEY, NEW); assert.equal(OLD_SETTINGS_KEY, OLD);
  assert.equal(settings.camera, 'broadcast'); assert.equal(settings.sfx, 0.4); assert.equal(settings.deadzone, 0.22);
  assert.deepEqual(settings.binds.key, { shoot: 'KeyJ' });
  assert.deepEqual(JSON.parse(store.m.get(NEW)), mine, 'copied over as it was');
  assert.equal(store.m.get(OLD), JSON.stringify(mine), 'the old entry is left alone');
  // from then on the new key is the one: a change is saved there, and the next start reads it
  settings.camera = '2k';
  (await import(`../client/js/core/settings.js?start=${fresh}`)).saveSettings();
  assert.equal(JSON.parse(store.m.get(NEW)).camera, '2k');
  assert.equal(JSON.parse(store.m.get(OLD)).camera, 'broadcast');
  assert.equal((await startWith(store)).settings.camera, '2k');
});

test('settings under the new name win; a new browser starts from the defaults; a full storage still reads the old ones', async () => {
  const both = storage({ [OLD]: JSON.stringify(mine), [NEW]: JSON.stringify({ ...mine, camera: 'side' }) });
  assert.equal((await startWith(both)).settings.camera, 'side');
  assert.equal(JSON.parse(both.m.get(OLD)).camera, 'broadcast');
  const none = storage();
  const { settings } = await startWith(none);
  assert.equal(settings.camera, '2k');
  assert.ok(!none.m.has(OLD), 'nothing written under the old name');
  assert.ok(none.m.has(NEW));
  const full = storage({ [OLD]: JSON.stringify(mine) }, { full: true });
  assert.equal((await startWith(full)).settings.camera, 'broadcast');
  assert.ok(!full.m.has(NEW));
});

test("the soundtrack's recent tracks, the ICON Squad windows and the shader log: the new keys, the old ones read until then", async () => {
  globalThis.localStorage = storage();
  const { recentTracks, oldRecentKey, PLAYLISTS } = await import('../client/js/core/music.js');
  assert.deepEqual(Object.values(PLAYLISTS).map(p => p.recent), ['rimrift.music.recent', 'rimrift.music.recent.beat', 'rimrift.music.recent.monster']);
  assert.equal(oldRecentKey('beat'), 'ah16.music.recent.beat');
  globalThis.localStorage = storage({ 'ah16.music.recent': '["a.mp3","b.mp3"]', 'ah16.music.recent.beat': '["x.mp3"]' });
  assert.deepEqual(recentTracks('main'), ['a.mp3', 'b.mp3']);
  assert.deepEqual(recentTracks('beat'), ['x.mp3']);
  globalThis.localStorage.setItem('rimrift.music.recent', '["c.mp3"]');
  assert.deepEqual(recentTracks('main'), ['c.mp3']);
  const sq = src('client/js/ui/squadwatch.js');
  assert.ok(sq.includes("const SEEN_KEY = 'rimrift.iconsquad.seen', OLD_SEEN_KEY = 'ah16.iconsquad.seen';"));
  assert.ok(sq.includes('localStorage.getItem(SEEN_KEY) ?? localStorage.getItem(OLD_SEEN_KEY)') && sq.includes('localStorage.setItem(SEEN_KEY,'));
  const r = src('client/js/gfx/renderer.js');
  assert.ok(r.includes("const PROGRAM_LOG = 'rimrift.programs.v1', OLD_PROGRAM_LOG = 'afterhours16.programs.v1';"));
  assert.ok(r.includes('localStorage.getItem(PROGRAM_LOG) ?? localStorage.getItem(OLD_PROGRAM_LOG)') && r.includes('localStorage.setItem(PROGRAM_LOG,'));
  // (a page-to-page hint, nothing kept: just the new name)
  assert.equal((src('client/js/ui/online.js').match(/'rimrift\.openOnline'/g) || []).length, 5);
  // the first-start check for the graphics preset looks at the key the settings are saved under
  assert.ok(src('client/js/main.js').includes('if (!localStorage.getItem(SETTINGS_KEY)) { settings.quality = autoQuality(app.renderer);'));
});

test('the scripts: RIMRIFT in every window title and message; their folders move over the first time', () => {
  const cmds = ['start.cmd', 'host.cmd', 'join.cmd'];
  for (const f of cmds) {
    const t = src(f);
    assert.ok(/^title RIMRIFT/m.test(t), `${f}: its window title`);
    assert.equal(t.split('\n').length - 1, (t.match(/\r\n/g) || []).length, `${f}: Windows line endings throughout`);
    assert.ok(!/afterhours/i.test(t.replace(/set "OLDCFG=%LocalAppData%\\Afterhours16(Join)?"/, '')), `${f}: the old name only where the old folder is found`);
  }
  for (const [f, oldDir, newDir] of [['host.cmd', 'Afterhours16', 'RIMRIFT'], ['join.cmd', 'Afterhours16Join', 'RIMRIFTJoin']]) {
    const t = src(f);
    assert.ok(t.includes(`set "OLDCFG=%LocalAppData%\\${oldDir}"\r\nset "CFG=%LocalAppData%\\${newDir}"\r\n` +
      'if not exist "%CFG%" if exist "%OLDCFG%" move "%OLDCFG%" "%CFG%" >nul 2>nul\r\n' +
      'if not exist "%CFG%" if exist "%OLDCFG%" set "CFG=%OLDCFG%"\r\n' +
      'if not exist "%CFG%" mkdir "%CFG%"\r\n'), `${f}: moved over, or used where it is while its browser is still open`);
  }
  assert.ok(src('start.cmd').includes('start "RIMRIFT service" /min'));
  assert.ok(src('host.cmd').includes('start "RIMRIFT online service"'));
  const sh = src('start.sh');
  assert.ok(sh.includes('echo "RIMRIFT is running at $URL'));
  assert.ok(!/afterhours/i.test(sh.replace('${AFTERHOURS16_PORT:-8765}', '')));
});

test('the package, the licence and the server files say RIMRIFT', () => {
  assert.equal(JSON.parse(src('package.json')).name, 'rimrift');
  assert.ok(src('LICENSE').includes('Copyright (c) 2026 RIMRIFT contributors'));
  assert.ok(src('server/__init__.py').includes('RIMRIFT'));
  assert.ok(src('server/venues.json').includes('"RIMRIFT Arena"'));
  assert.ok(!/afterhours/i.test(src('server/venues.json') + src('online.json') + src('LICENSE') + src('package.json')));
  // (the catalog's item ids never change: they're in everyone's inventory; their names say RIMRIFT, v0486brand.test.mjs)
  assert.ok(src('server/catalog.json').includes('"id": "tee_black_ah16"'));
});
