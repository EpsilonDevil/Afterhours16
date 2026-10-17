// v0.4.7.5 quick patch 3: post moves. Hold the post-up trigger (LT / L2, X on the keyboard, right click) with the ball
// and you put your back to the basket: the left stick toward the rim backs the defender down, sideways shuffles, away
// steps out. From there the right stick calls the moves — left/right a drop step round that side, up a post spin to
// the rim, down the up-and-under (a pump fake, then the step through) — and the shot button shoots out of the post:
// stick toward the rim a hook, away a fadeaway, neutral a turnaround jumper. Ten Post Move Packages (slot 'post')
// decide how the moves look and how much they bite. How much everything bites (postPower) comes from the package,
// the Post Control rating, height and the archetype: Post Scorers' post moves are the most effective in the game.
//
// Nothing here imports the sim: game.js, ai.js, the animator, the store and the preview all read from it.
import { RED_POST_PKG, RED_ICON, RED_IDS, RED_BACKDOWNS, RED_FINISHES } from './redpost.js'; // (qp5: Sexy Red's package: data only)

export const POST = {
  range: 5.4,          // post-ups happen inside this of the rim
  back: [0.55, 1.45],  // back-down speed (m/s) at power/resist of 0 and 1+
  shuffle: 1.1, out: 1.35,
  lean: 0.08,          // seconds of posting kept after the trigger lets go (the animator's back-to-basket stance)
  tier: [0, 0, 55, 65, 78, 90], // Post Control needed per package tier (height moves it a tier: postPackageNeed; Fundamentals is always free)
  tall: 83, short: 73,
  // the archetypes: how well each one's game translates to the block (Post Scorers best, by design)
  arch: { post_scorer: 1.35, glass_cleaner: 1.02, stretch_big: 0.88, two_way: 0.86, slasher: 0.76, lockdown: 0.72, playmaker: 0.66, sharpshooter: 0.6 },
  shield: { hook: 0.42, fade: 0.4, turn: 0.26 }, // how much of the contest the release takes away (×emph), before a beat
  beatShield: 0.5,     // a beaten defender's contest counts half
  bonus: 0.085,        // the shot-chance bonus at full power (×emph × power), + the beat bonus
  beatBonus: 0.14,
};

// the moves: dur (s), step (m the move travels), ang (rad round the defender for the drop step), bite (how hard it
// beats the man), fakeAt (the up-and-under: the share of the move that's the fake)
export const POST_MOVES = {
  dropstep: { name: 'Drop step', dur: 0.54, step: 1.3, ang: 0.95, bite: 1.0 },
  postspin: { name: 'Post spin', dur: 0.62, step: 1.15, ang: 0.6, bite: 1.1 },
  upunder: { name: 'Up-and-under', dur: 0.82, step: 1.05, ang: 0.5, bite: 1.2, fakeAt: 0.42 },
};
export const POST_SHOTS = { hook: { name: 'Hook', tRel: 0.5, arc: 60 }, fade: { name: 'Fadeaway', tRel: 0.62, arc: 52 }, turn: { name: 'Turnaround', tRel: 0.56, arc: 50 } };

// The packages. emph: how much it bites and sells (1 = Fundamentals, 1.5 = the top tier). sig: its signature moves
// and shots (quicker, bite harder, the preview leads with them). hook: the hook's shape — baby (short, from the chest),
// jump (up and over), sky (the full sweep from the hip). fade: lean (a lean back) or high (up and back, the ball
// held high). body: the back-down — bully (low and wide, shoulder bumps), smooth (upright, patient), quick (short
// steps, feints). Two a tier: five tiers.
export const POST_PACKAGES = [
  { id: 'post_basic', tier: 1, name: 'Fundamentals', price: 0, emph: 1.0, sig: [], hook: 'baby', fade: 'lean', body: 'smooth', desc: 'The basics on the block: a back-down, a drop step, a spin, a baby hook and a turnaround. On every build.' },
  { id: 'post_bully', tier: 1, name: 'Bully Ball', price: 2900, emph: 1.08, sig: ['dropstep'], hook: 'baby', fade: 'lean', body: 'bully', desc: 'Low, wide and physical: a back-down that leans on the man with the shoulder, and a drop step that goes through him.' },
  { id: 'post_footwork', tier: 2, name: 'Footwork', price: 5200, emph: 1.15, sig: ['upunder', 'dropstep'], hook: 'baby', fade: 'lean', body: 'quick', desc: 'Quick feet on the block: a sharp drop step and an up-and-under with a fake the man has to honour.' },
  { id: 'post_babyhook', tier: 2, name: 'Baby Hook', price: 5800, emph: 1.15, sig: ['hook'], hook: 'baby', fade: 'lean', body: 'smooth', desc: 'A soft short hook off either shoulder, up before the help gets there.' },
  { id: 'post_dreamshake', tier: 3, name: 'Dream Shake', price: 8900, emph: 1.25, sig: ['upunder', 'postspin'], hook: 'jump', fade: 'high', body: 'quick', desc: 'Feints and spins: the up-and-under sells the fake with the whole body, and the spin goes the other way from where the man leans.' },
  { id: 'post_fadeaway', tier: 3, name: 'Fadeaway', price: 8900, emph: 1.25, sig: ['fade', 'turn'], hook: 'jump', fade: 'high', body: 'smooth', desc: 'The turnaround fade: up and back off the back-down, the ball held high, nobody gets a hand near it.' },
  { id: 'post_skyhook', tier: 4, name: 'Sky Hook', price: 13500, rep: 4, emph: 1.36, sig: ['hook'], hook: 'sky', fade: 'lean', body: 'smooth', desc: 'The full sweep from the hip, up and over the top, the off arm out as a shield. Unblockable in its day.' },
  { id: 'post_powerspin', tier: 4, name: 'Power Spin', price: 13500, rep: 4, emph: 1.36, sig: ['postspin', 'dropstep'], hook: 'jump', fade: 'lean', body: 'bully', desc: 'A back-down that moves the man, then a spin into the lane that leaves him behind, finished with a jump hook or a dunk.' },
  { id: 'post_legend', tier: 5, name: 'Low Post Legend', price: 19900, rep: 8, ovr: 85, emph: 1.5, sig: ['dropstep', 'postspin', 'upunder', 'hook', 'fade'], hook: 'sky', fade: 'high', body: 'smooth', desc: 'The whole repertoire at its best: every move and every shot out of the post is a signature. The top tier.' },
  { id: 'post_backboard', tier: 5, name: 'Backboard Bully', price: 19900, rep: 8, ovr: 85, emph: 1.5, sig: ['dropstep', 'postspin', 'turn', 'hook'], hook: 'jump', fade: 'lean', body: 'bully', desc: 'Power at the top tier: a back-down nobody holds, a drop step into a dunk, a jump hook off the glass. The top tier.' },
];
// v0.4.8.5 qp5: an Icon badge's own package (sim/redpost.js): Sexy Red's. The holder's alone (postPackageOf gives anyone
// else Fundamentals), never in the store, free; it bites like the top tier and no more. body 'red': its five back-downs
// (char/redpose.js); its signature turnaround and hook carry their own flourish
export const POST_ICON_PACKAGES = [
  { id: RED_POST_PKG, tier: 5, name: 'Sexy Red', price: 0, icon: RED_ICON, emph: 1.5, sig: ['dropstep', 'postspin', 'turn', 'hook'], hook: 'jump', fade: 'high', body: 'red', backdowns: RED_IDS,
    desc: `The Post Scorer Icon's own: five back-downs nobody else has, one after another as you work the man (${RED_BACKDOWNS.map(s => `the ${s.name}`).join(', ').replace(/, (the [^,]+)$/, ' and $1')}), and two signature finishes with a flourish of their own: the ${RED_FINISHES.turn} and the ${RED_FINISHES.hook}. Bites like the top tier. Comes with the Sexy Red Icon badge, for that build only; it cannot be bought.` },
];
export const POST_PKG_BY_ID = Object.fromEntries([...POST_PACKAGES, ...POST_ICON_PACKAGES].map(p => [p.id, p]));
export const POST_PKG_IDS = POST_PACKAGES.map(p => p.id);

// the Post Control a build needs for a tier, by height: 6'11" and up a tier less, 6'1" and under a tier more
export function postPackageNeed(tier, height, id = null) {
  if (id === 'post_basic') return 0;
  let t = tier;
  if (height >= POST.tall) t -= 1; else if (height <= POST.short) t += 1;
  t = Math.max(1, Math.min(POST.tier.length - 1, t));
  return POST.tier[t];
}
// the catalog entries (server/catalog.json mirrors these exactly: a test checks it)
export function postPackageItems() {
  return POST_PACKAGES.map(p => ({
    category: 'animation', min_overall: p.ovr || 0, rep_required: p.rep || 0, original_2k_asset: false,
    description: p.desc + (p.tier > 1 ? ` Requires ${POST.tier[p.tier]} Post Control (6'11"+: ${postPackageNeed(p.tier, POST.tall, p.id)}; 6'1" and under: ${postPackageNeed(p.tier, POST.short, p.id)}).` : ''),
    id: p.id, name: `Post Move Package: ${p.name}`, slot: 'post', price: p.price, style: p.id.slice(5), tier: p.tier, emph: p.emph, sig: [...p.sig], hook: p.hook, fade: p.fade, body: p.body,
    v0475qp3: true, min_attr: { post_control: p.id === 'post_basic' ? 0 : POST.tier[p.tier] }, min_attr_tall: { post_control: postPackageNeed(p.tier, POST.tall, p.id) }, min_attr_short: { post_control: postPackageNeed(p.tier, POST.short, p.id) }, tall_height: POST.tall, short_height: POST.short,
  })).concat(POST_ICON_PACKAGES.map(p => ({
    // (qp5: an Icon's package: no requirement but the badge, which app.eligible checks)
    category: 'animation', min_overall: 0, rep_required: 0, original_2k_asset: false, description: p.desc,
    id: p.id, name: `Post Move Package: ${p.name}`, slot: 'post', price: 0, style: p.id.slice(5), tier: p.tier, emph: p.emph, sig: [...p.sig], hook: p.hook, fade: p.fade, body: p.body,
    backdowns: [...p.backdowns], min_attr: {}, exclusive: 'icon', icon: p.icon, secret: true, v0485qp5: true,
  })));
}
// the package he plays: what he wears; an Icon's package only on the build that holds that Icon badge
export const postPackageOf = p => { const k = POST_PKG_BY_ID[p?.postPkg]; return k && (!k.icon || k.icon === p?.icon) ? k : POST_PACKAGES[0]; };
export const isSig = (p, what) => postPackageOf(p).sig.includes(what);

// (v0.4.8.5 qp5: Post Control past 99 keeps counting, where an Icon badge takes it (Sexy Red's +5%: 103.95), at the
// same rate as below, up to what 105 gives; at 99 and under it is exactly what it always was)
export const PC_TOP = 105;
const n = v => Math.max(0, Math.min((PC_TOP - 25) / 74, ((v ?? 50) - 25) / 74));
// how well he plays on the block: the package's emphasis × his Post Control × his archetype × his height
export function postPower(p) {
  const pkg = postPackageOf(p);
  const arch = POST.arch[p.archetype] ?? 0.8;
  const h = p.heightIn ?? p.build?.height ?? 78;
  const hK = Math.max(0.75, Math.min(1.1, 0.78 + (h - 69) * 0.017));
  return pkg.emph * (0.35 + 0.65 * n(p.ratings?.post_control)) * arch * hK;
}
// how well a defender holds his ground against it. (v0.4.8.5: Interior D keeps paying off past 99, where an Icon badge
// takes it (Open Arms' +3%, Big Brother's +5%): it used to stop at 99 here, the one place in the sim it did)
const nUp = v => Math.max(0, ((v ?? 50) - 25) / 74);
export function postResist(d) {
  return (0.55 + 0.45 * nUp(d.ratings?.interior_d)) * (0.88 + 0.24 * (d.phys?.strength ?? 0.5)) * (d.badges?.brick_wall ? 1 + 0.06 * d.badges.brick_wall : 1);
}
// the back-down: m/s he moves the man toward the rim
export function backdownSpeed(p, d) {
  const pw = postPower(p) * (0.85 + 0.3 * (p.phys?.strength ?? 0.5)), rs = d ? postResist(d) : 0.5;
  const k = Math.max(0, Math.min(1, pw / (pw + rs) * 1.35 - 0.2));
  return POST.back[0] + (POST.back[1] - POST.back[0]) * k;
}
// the chance a move beats the man (he's a step late to the finish)
export function beatChance(p, d, move) {
  const M = POST_MOVES[move]; if (!M) return 0;
  const margin = postPower(p) * (0.85 + 0.3 * (p.phys?.strength ?? 0.5)) - (d ? postResist(d) : 0.6);
  return Math.max(0.04, Math.min(0.8, (0.2 + margin * 0.5) * M.bite * (isSig(p, move) ? 1.12 : 1)));
}
// shots out of the post: how much of the contest the release takes away, and the chance bonus
export function postShotK(p, kind, beat) {
  const pkg = postPackageOf(p), pw = postPower(p);
  const sig = isSig(p, kind) ? 1.1 : 1;
  // (the release's shield grows with the package and the power; a beaten man adds his own share, capped so a good
  // defender still counts)
  const shield = Math.min(0.5, (POST.shield[kind] || 0.2) * pkg.emph * sig * (0.55 + 0.45 * Math.min(1.6, pw))) + (beat ? POST.beatShield * 0.4 : 0);
  const bonus = POST.bonus * pkg.emph * Math.min(1.6, pw) * sig + (beat ? POST.beatBonus : 0);
  return { shield: Math.min(0.62, shield), bonus };
}
export const postMoveName = m => POST_MOVES[m]?.name || m;
export const postShotName = k => POST_SHOTS[k]?.name || k;
