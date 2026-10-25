// v0.4.8.9 qp8: the Pro-Am team's own rank (division and RP, apart from each player's) and how far its next HUB building
// is, on the team page, the office whiteboard (both the menu's and the one drawn in the HUB) and the HUB's badge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { teamProgress, whiteboardData } from '../client/js/world/proamhubs.js';

const src = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('series wins to the next building: 3 from Bronze 1, 5 from Silver 1, 7 from Gold 1; Platinum is the top for now', () => {
  const at = div => teamProgress({ div, rp: 40 });
  assert.deepEqual([at(0).wins, at(0).nextTier, at(0).building], [3, 'Silver', 'Northgate High School Gym']);
  assert.deepEqual([at(2).wins, at(3).wins, at(8).wins, at(14).wins], [1, 5, 7, 1]);
  assert.equal(at(8).building, 'The Clubhouse · Platinum');
  assert.equal(at(15).nextTier, null); assert.match(at(15).text, /top building for now/);
  assert.equal(at(0).rp, 40); assert.equal(teamProgress(null), null);
  // the server's team view (division object) reads the same
  assert.equal(teamProgress({ division: { tier: 1, div: 4, divs: 5, label: 'Silver 4' }, rp: 70 }).text, '2 series wins to Gold: The Clubhouse');
});

test('the team rank shows on the team page, both whiteboards and the HUB badge', () => {
  const d = whiteboardData({ name: 'Night Owls', division: { tier: 0, div: 2, divs: 3, label: 'Bronze 2' }, rp: 55 });
  assert.equal(d.teamRP, 55); assert.equal(d.nextBuilding, '2 series wins to Silver: Northgate High School Gym');
  assert.match(src('client/js/world/proamhubs.js'), /marker\(`TEAM: \$\{d\.division\}/);
  const ui = src('client/js/ui/proam.js');
  assert.match(ui, /TEAM RANK<\/div>\$\{divChip\(t\.division, 30\)\}\$\{rpBar\(teamProgress\(t\)\?\.raw \?\? t\.rp\)\}/);
  assert.match(ui, /<b>Team<\/b>\$\{divChip\(team\.division, 22\)\}/);
  assert.match(ui, /Their own rank/);
  assert.match(src('client/js/game/proamhub.js'), /Team \$\{esc\(tp\.label\)\} · \$\{tp\.raw\} RP · \$\{esc\(tp\.text\)\}/);
});

test('qp9: RP past 100 is banked while the series plays out, and shown as carrying into the next division', () => {
  const p = teamProgress({ div: 1, rp: 130 });
  assert.deepEqual([p.rp, p.raw, p.banked], [100, 130, 30]);
  assert.equal(p.text, '2 series wins to Silver: Northgate High School Gym · +30 RP carries into the next division');
  assert.equal(teamProgress({ div: 1, rp: 100 }).banked, 0);
  assert.equal(whiteboardData({ name: 'X', div: 1, rp: 130 }).teamRP, 130);
});
