// v0.4.8.9 qp13: the Pro-Am HUB and Pro-Am games play the park's soundtrack (the main list) at about 10% of the level
// you'd hear in the park; anywhere else it's back to the full level. The Pro Run still sits the music out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Soundtrack, PROAM_MUSIC } from '../client/js/core/music.js';
import { settings, volumeGain } from '../client/js/core/settings.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Pro-Am plays at about a tenth of the park level, and a park game duck never stacks on it', () => {
  assert.equal(PROAM_MUSIC, 0.10);
  const m = new Soundtrack();
  m.wanted = true; settings.musicVol = 0.65;
  const full = volumeGain(0.65);
  assert.ok(Math.abs(m.target() - full) < 1e-9, 'the park: the full level');
  m.setPlaylist('main', { level: PROAM_MUSIC });
  assert.ok(Math.abs(m.target() - full * 0.10) < 1e-9, 'Pro-Am: 10%');
  m.duck(true);
  assert.ok(Math.abs(m.target() - full * 0.10) < 1e-9, 'a game in the HUB: still 10%, not 6.5%');
  m.setPlaylist('main');
  assert.ok(Math.abs(m.target() - full * 0.65) < 1e-9, 'back anywhere else: the full level (ducked in a park game)');
  m.duck(false);
  assert.ok(Math.abs(m.target() - full) < 1e-9);
  m.setPlaylist('main', { level: PROAM_MUSIC }); m.setSuppressed(true);
  assert.equal(m.target(), 0, 'suppressed is still silent');
});

test('the HUB and every Pro-Am game ask for it; the Pro Run stays quiet', () => {
  const modes = src('client/js/ui/modes.js');
  assert.equal((modes.match(/music\.setPlaylist\('main', \{ level: PROAM_MUSIC \}\); music\.setSuppressed\(false\)/g) || []).length, 3);
  assert.doesNotMatch(modes, /music\.setSuppressed\(true\)/);
  assert.match(src('client/js/game/proamhub.js'), /music\.setPlaylist\?\.\('main', \{ level: PROAM_MUSIC \}\); music\.setSuppressed\?\.\(false\)/);
  assert.ok(src('client/js/ui/prorun.js').includes("music.setPlaylist('main'); music.setSuppressed(true);"));
  // (the menus, the park and the Crew HQ ask for their playlist with no level: the full one)
  assert.ok(src('client/js/ui/screens.js').includes("music.setPlaylist('main');"));
  assert.ok(src('client/js/game/park.js').includes("music.setPlaylist(this.theme?.music || 'main');"));
  assert.ok(src('client/js/game/crewhq.js').includes("music.setPlaylist('main');"));
});
