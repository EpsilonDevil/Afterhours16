// GPU lifetimes (QP3, the leak fix): what a scene owns is freed when the scene is left; what a cache keeps for reuse is
// marked shared and kept.
//
// The rule, for everyone who makes GPU resources (geometry from ctx.geometry, textures from ctx.texture):
//  * a texture or geometry a cache keeps for reuse carries `shared = true` (set where the cache makes it: share()).
//    Disposal never frees a shared resource. The caches that mark theirs: world/court.js cachedTexture, the court
//    overlays and the wood and asphalt maps (leased: below), world/parklife.js and world/favela.js, char/view.js
//    sharedTex, game/session.js PlayerVisual.blobGeo.
//  * everything else belongs to the scene it's drawn in, and releaseScene() frees it when that scene is left: every
//    mesh's geometry and material textures, and the scene's env map. A piece taken out of the scene before then frees
//    its own (freeMeshes).
//  * the athletes' shared textures (char/view.js sharedTex: skin, hair, shoes, chains, bandanas...) are leased too, by
//    hand: every AthleteView holds the entries it was built with (hold) and lets them go when it's disposed (letGo); a
//    VisualPool's parked views keep theirs until the pool disposes them. Unheld ones stay up to ATHLETE_BUDGET.
//  * the venue caches in world/court.js are leased: a cache entry made or used while a venue is being built (buildScope:
//    world/venues.js buildVenue, world/proamhubs.js buildProamHub) is held by that scene until it's released; one used
//    anywhere else is pinned for good. Entries nobody holds stay cached up to CACHE_BUDGET bytes (going back to a park
//    you just left builds it again from the cache); past that, the ones unused longest are freed (made again, the same
//    pixels, if they're ever needed).
// Called by game/park.js, game/crewhq.js, game/proamhub.js, game/session.js (a game's own scene), game/deckcine.js.

// ---------- the marker ----------
export function share(res) { if (res && typeof res === 'object') res.shared = true; return res; }

// ---------- leased cache entries ----------
// (bytes of venue textures kept with no scene using them: enough for a park, the Crew HQ and the Pro-Am HUB together
// (measured 228 + 91 + 89 MB), so walking between them never builds one again)
export const CACHE_BUDGET = 384 * 1048576;
// (bytes of athlete textures nobody's wearing: a budget of their own, so a park's crowd coming and going never pushes a
// venue's overlays out, or the other way round. A park's crowd wears about 40-60 MB of them at once; 96 MB more of the
// ones just taken off covers the people who walk off and come back)
export const ATHLETE_BUDGET = 96 * 1048576;
const BUDGETS = { venue: CACHE_BUDGET, athlete: ATHLETE_BUDGET };
export const texBytesOf = t => Math.round((t?.width || 0) * (t?.height || 0) * 4 * 4 / 3);
const entries = new Set();
let building = null, clock = 0;
// run fn while scene's venue is built: the cache entries it uses are held by the scene
export function buildScope(scene, fn) {
  const prev = building;
  building = scene._leases || (scene._leases = new Set());
  try { return fn(); } finally { building = prev; }
}
// a cache entry: {res: [textures], bytes, drop()} (drop takes it out of its cache); every use goes through use() (venue
// caches) or hold() (athletes). group: whose budget it counts against
export function leaseEntry(entry, group = 'venue') {
  entry.refs = 0; entry.pinned = false; entry.last = 0; entry.group = group;
  for (const r of entry.res) share(r);
  entries.add(entry);
  return entry;
}
export function use(entry) {
  entry.last = ++clock;
  if (!building) entry.pinned = true;
  else if (!building.has(entry)) { building.add(entry); entry.refs++; }
  return entry;
}
// an athlete's hold on an entry (held: the view's own set), and letting go of all of them (its dispose)
export function hold(entry, held) {
  entry.last = ++clock;
  if (held && !held.has(entry)) { held.add(entry); entry.refs++; }
  return entry;
}
export function letGo(ctx, held) {
  if (!held || !held.size) return;
  for (const e of held) e.refs--;
  held.clear();
  trimCaches(ctx, null, 'athlete');
}
// free the unheld entries past the budget (each group's own, or the one given for all), the ones unused longest first
export function trimCaches(ctx, budget = null, group = null) {
  for (const gr of group ? [group] : Object.keys(BUDGETS)) {
    const cap = budget ?? BUDGETS[gr];
    let bytes = 0;
    for (const e of entries) if (e.group === gr && !e.pinned && e.refs <= 0) bytes += e.bytes;
    if (bytes <= cap) continue;
    const idle = [...entries].filter(e => e.group === gr && !e.pinned && e.refs <= 0).sort((a, b) => a.last - b.last);
    for (const e of idle) {
      if (bytes <= cap) break;
      entries.delete(e); e.drop();
      for (const r of e.res) if (r && typeof r === 'object') { r.shared = false; freeTexture(e.ctx || ctx, r); } // (on the context that made it)
      bytes -= e.bytes;
    }
  }
}
export const cacheStats = (group = 'venue') => { let held = 0, idle = 0, pinned = 0, n = 0; for (const e of entries) { if (e.group !== group) continue; n++; if (e.pinned) pinned += e.bytes; else if (e.refs > 0) held += e.bytes; else idle += e.bytes; } return { entries: n, held, idle, pinned }; };

// ---------- freeing ----------
const MAPS = ['map', 'normalMap', 'roughMap', 'emissiveMap', 'detailMap'];
function materialTextures(mat, out) {
  if (!mat) return;
  for (const k of MAPS) if (mat[k]) out.add(mat[k]);
  if (mat.floor?.overlay) out.add(mat.floor.overlay);
}
export function freeTexture(ctx, t) { if (t && t.tex && !t.shared && !t.freed) { t.freed = true; ctx.disposeTexture?.(t); } }
export function freeGeometry(ctx, g) { if (g && g.vao && !g.shared && !g.freed) { g.freed = true; ctx.disposeGeometry?.(g); } }
// the geometry and textures of these meshes (taken out of the scene by their owner), the shared ones kept
export function freeMeshes(ctx, meshes) {
  const texs = new Set();
  for (const m of meshes) { if (!m) continue; freeGeometry(ctx, m.geo); materialTextures(m.material, texs); }
  for (const t of texs) freeTexture(ctx, t);
}
// the scene is being left for good: free everything in it that isn't shared, let go of its cache leases, and empty it
// (a frame drawn with it before the next scene is up draws nothing)
export function releaseScene(ctx, scene) {
  if (!ctx || !scene || scene.released || !Array.isArray(scene.meshes)) return;
  scene.released = true;
  freeMeshes(ctx, scene.meshes);
  freeTexture(ctx, scene.env);
  scene.meshes.length = 0;
  for (const e of scene._leases || []) e.refs--;
  scene._leases = null;
  trimCaches(ctx);
}
