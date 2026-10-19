# RIMRIFT — Stage 0.5 spike: G0 gate report

**Date:** Oct 18, 2026 · **Baseline ported against:** v0.4.8.6 + its quick patches (the ICON Squad, the season reset, the opening) — the port baseline as tagged in STATUS.md. None of the modules the spike ports (sim/ball.js, shots.js, ratings.js, constants.js, core/rng.js, char/animator.js, skeleton.js, pose.js, rig.js, world/venues.js, harbor.js, court.js, props.js, net.js, themes.js) changed in those patches (checked by hash after each one).

**Engine:** Godot 4.7.2 stable .NET (Forward+, Jolt), .NET 8 SDK 8.0.426, C# 12. **Team:** Rules agent, World agent, Character agent, lead — one session, run in parallel.

## The gate, line by line

| G0 condition (roadmap, Stage 0.5) | Result | Evidence |
|---|---|---|
| C# ball / shots / ratings / constants with a parity harness | **PASS** | `sim/Rimrift.Sim` (no Godot dependency). 1,000 pre-simulated shots replayed: 396,080 ticks × 9 doubles + 5 flags compared **bit for bit**, 12,447 events in order, **0 divergences**. `planShot` (launch velocity + spin, make/miss/bank/ghost, RNG state after): 1,000/1,000 identical. xUnit 28/28. |
| Ball parity exact over 1,000 shots | **PASS** | as above — bit-exact on the first replay and on the lead's re-run (`dotnet run --project harness/Rimrift.Harness -- --all` → PASS, 94.8 s) |
| No tunnelling at 20 m/s | **PASS (both solvers)** | Our solver (JS semantics, SUB=4): 10,368 trajectories at 15/20/25 m/s, 0 through-tube, 0 ended-inside. Jolt (ball RigidBody3D vs the rim): 0 tunnelling at every speed with CCD on, at 60/120/240 Hz, for capsule-ring, convex and trimesh rims; **without CCD, 3% at 60 Hz / 20 m/s and 11% at 25 m/s** — CCD is required. |
| Jolt ball-on-rim | **PASS** | `game/scenes/harbor/JoltRimTest.tscn`; trimesh torus with backface collision is the faithful shape; the three shapes behave the same. Ten kinematic capsule athletes + ball: 0.16–1.0 ms per physics tick on the cloud CPU. |
| Harbor Point at sunset | **PASS, with a visual gap** | `HarborPoint.tscn` generated from the JS layout export: `HarborLayout.Verify` — **375 values match the JS**, rim positions identical (Court0 Rim+ = (0, 3.05, 12.725) …). Sunset reads at gameplay distance; it is lighter and more pastel than the concept art (see "honest gaps"). |
| One target-quality athlete driven by the ported procedural animator | **Animator PASS · athlete NOT at the bar** | `sim/Rimrift.Anim`: the animator, rig, pose and skeleton ported; 3 builds × 725 ticks against JS traces — target pose **bit-exact**, final pose ≤ 6e-8 (one float ulp), joints ≤ 8e-8 m. The athlete asset reads as the kit at ~10 m (jersey, 39, piping, sleeve, socks, shoes, skin) but not in close-up: stocky body, crumpled jersey, generic face, cap-like hair. **David's sign-off is the open item** — see the decision below. |
| 60 fps with 10 athletes on David's GPU | **PASS — 120 fps with 11 athletes (RTX 2070 Super, Oct 18)** | Measured by David in the demo exe (gameplay camera, A for ten more athletes). Budget numbers: park 104k scene triangles (palms 54k), 60–89 draw calls, ~340k primitives/frame with shadows at 1080p; 11 athletes ≈ +560k primitives (48k tris per athlete, no LOD yet), 438–453 draw calls. On the target GPUs (RTX 2070 Super / RX 6600, decision 3) this should be far above 60 fps; the number from the PC is the gate. |

**Decisions taken on the report (David, Oct 18):** athletes go **MetaHuman** (decision 2 closed); the park look got a second pass over the concept art (poster now luma 0.32 / sat 0.67 vs the target's 0.35 / 0.61, from 0.53 / 0.47; `game/assets/world/renders/contact_sheet_vs_target.png` is target | before | after). The root cause of the pastel look was an sRGB/linear mix-up in the vertex-coloured materials (`VertexColorIsSrgb`), fixed in MeshKit.

**Verdict:** Option C (Godot + C# + Jolt) is proven on everything that was an engineering risk — the sim ports exactly, the rules are deterministic and CRT-independent, Jolt handles the ball/rim, the park layout carries over to the millimetre, the animator carries over bit-exactly, the whole thing builds and exports headless from the cloud. The one thing not proven is the **art bar for athletes**, which was never an engine question: it is a decision about where bodies come from (decision 2 of the roadmap).

## What exists (rimrift/ in the repo)

```
rimrift/
  SPIKE.md                       the agents' working contract (toolchain, layout, rules)
  G0-REPORT.md                   this report
  .gitattributes / .gitignore    Git LFS for .glb/.png/.exe/.zip; bin/obj/.godot/harness out/dist ignored
  game/                          Godot 4.7.2 .NET project (open game/project.godot; main scene = scenes/Demo.tscn)
    scenes/Demo.tscn             the G0 demo (park + athlete + the C# ball solver), scripts/Demo.cs
    scenes/harbor/               HarborPoint.tscn, JoltRimTest.tscn, TenAthletes.tscn
    scenes/athlete/              Athlete.tscn, AthleteShowroom.tscn
    scripts/world/               HarborLayout, HarborPoint(+Courts/Nature/Props), MeshKit, JoltRimTest, TenAthletes, WorldProbe
    scripts/anim/                AthleteDriver (60 Hz fixed step → Skeleton3D), AthleteShowroom
    shaders/world/               sky, sea, court
    assets/world/                harbor_layout.json (from the JS), procedural textures, renders/, SOURCES.md
    assets/athlete/              athlete.glb (CC0 Blender base mesh, our garments/textures), renders/, SOURCES.md
    export_presets.cfg           Windows Desktop x86_64 (.NET), pck embedded
  sim/Rimrift.Sim/               the port: Constants, Rng, JsMath (V8-exact maths), Ball, Shots, Ratings, Badges, Body, Model
  sim/Rimrift.Sim.Tests/         xUnit (28): ports of the ball/shots/ratings Node tests + the parity gate as tests
  sim/Rimrift.Anim/              Skeleton, Pose, Rig, Animator (+Actions/Tables), MathJs
  sim/Rimrift.Anim.Tests/        xUnit (7): 3 parity replays + skeleton tests
  harness/                       export_traces.mjs (Node, reads client/js read-only) · Rimrift.Harness (C#: --traces --planner --tunnel --math --all) · anim_traces.mjs + traces/
  tools/world/                   export_layout.mjs, make_textures.py
  tools/athlete/                 Blender 4.5 headless pipeline: skel.py, build_body.py, build_athlete.py, textures.py, check_render.py, overlay.py
  dist/parts/                    the demo exe (RIMRIFT-G0-spike.zip in four parts + JOIN.cmd); dist/ itself is gitignored
```

## The numbers behind the port

**Why the port is bit-exact (and will stay so on Windows).** Plain arithmetic and `sqrt` are IEEE-identical in V8 and .NET, but `Math.hypot`, `sin/cos/tan`, `exp/log/pow` and `Math.round` are not: V8 uses its own fdlibm code, .NET calls the C runtime, and glibc and the Windows UCRT differ from each other too. `JsMath.cs` ports V8's implementations (hypot = Kahan-compensated, max-normalised sum; fdlibm trig/exp/log/pow; ECMAScript round). Checked against Node 22 (V8 12.4) on 1,600,042 samples: **0 mismatches**; `System.Math` alone mismatches on 3.4% of sin/cos, 7.7% of exp, 4.3% of log, 12% of pow and 38% of hypot samples — so a naive port would have drifted, and the same C# will also be what the future authoritative server runs.

**Tunnelling — what SUB=4 does and does not do.** A 25 m/s sub-step moves the ball 10.4 cm; the contact shell (ball radius + tube) is 12.9 cm, so the centre can never cross the metal unseen — hence zero through-tube at any speed. What SUB=4 misses is *glancing* contacts: at 20 m/s, 255 of 10,368 trajectories (2.5%) pass up to 7.4 mm inside the contact shell between sub-steps without a rim event (the ball should have grazed the rim). SUB=8 cuts that to 36 (≤ 1.4 mm), SUB=16 to 11 (≤ 0.19 mm). This is a property of the live game's rules, kept as-is for parity; the Stage 2 plan's "8 sub-steps near the rim / analytic torus sweep" is the fix, and it is a rules change (it alters make/miss outcomes vs the browser game), so it belongs in v0.4.9.5, re-tuned against the batch stats.

**Jolt, 20 m/s rows (300 trajectories each):**

| rim shape | 60 Hz, CCD on | 60 Hz, CCD off | 120 Hz, CCD on | 120 Hz, CCD off |
|---|---|---|---|---|
| capsule ring | 0 / 278 | 7 (3.1%), deep penetration 159 | 0 / 252 | 0, deep penetration 156 |
| convex | 0 / 276 | 7 (3.1%), 155 | 0 / 253 | 0, 159 |
| trimesh torus | 0 / 277 | 6 (2.8%), 154 | 0 / 254 | 0, 153 |

Without CCD the ball also sinks deep into the tube even when it does not pass through. Conclusion for Stage 2: Jolt ball-vs-rim is fine for *loose balls* with CCD on; shots stay on our solver (the roadmap's plan), which is what the demo does.

**Harbor Point.** Layout: 375 derived values (court dims, every rim, fence run, pole, bench, trash can, Got Next spot, the waterline) match the JS export; the gameplay camera is camera.js's 2K cam reproduced (pos (0, 8.5, −11.5), target (0, 0.9, 6.2), vertical FOV 44). Budget at 1080p, Forward+: poster camera 310k primitives / 89 draw calls / 351 MB video memory (254 MB textures); gameplay camera 293k / 60. Scene triangles 104k = palms 54k, hoops 23k (the net strands), props 14k, fences 7k, terrain 4k, court 0.9k. Palms and nets are the LOD targets for Stage 1.5.

**Athlete.** CC0 Blender Human Base Meshes v1.4.1 body + eyes, retargeted to our 21-bone skeleton at the sheet's build (77 in / 215 lb / 80 in; Godot reports rest-vs-bind error 0.00 mm), garments lofted from the body, 3,396 hidden body faces removed, textures painted procedurally (skin 2K, jersey 2K×1K with the RIMRIFT wordmark and 39, Inter Black Italic, OFL). ~48k triangles as exported (29k without the solidify shells), 17.6 MB glb. The showroom captures the jumper at dip / set / release (0.60 s, the green window) / landing on the exact ticks.

**Tests, final run (lead):** `dotnet test game/Rimrift.sln` → Rimrift.Sim.Tests 28/28, Rimrift.Anim.Tests 7/7; harness `--all` → PASS; Godot headless import clean; Windows export clean (`godot --headless --export-release "Windows Desktop"`, 30 s).

## Honest gaps

1. **The athlete is not at the character sheet's bar in close-up.** The body is a plain adult male (no athletic sculpt, reads stocky with the garment offsets), the jersey has a crumpled fold across the chest and creases on the back (shrinkwrapped loft, not a modelled garment), the hair is a cap rather than curls, the face is the base mesh's generic face with painted beard and brows. At gameplay distance it reads as the kit; the renders are honest about the rest (game/assets/athlete/renders/contact_sheet_vs_target.png).
2. **Harbor at sunset is lighter and more pastel than the concept art.** The target is darker and higher-contrast (deep orange sky, silhouetted fences and palms, dark blue sea). Volumetric fog had to go (it veiled the park); the sky is a custom shader, not an HDRI; palms are simple cards. Getting the last 30% needs a real sky/HDRI and a proper palm asset, not more parameter turning (game/assets/world/renders/contact_sheet_vs_target.png).
3. **Fps on real hardware is unmeasured** (no GPU in the cloud). The demo shows it; David measures.
4. **Not ported in the spike (by design):** the Icon-package pose modules (bigbro, clamp, redpose, oprahpose, snags, hashsling bodies), the 30 styled blocks, ankle-breaker victims, the rest of the celebrations, `clearOthers`, `postPackageOf` — all logged as stubs in `Animator.StubsHit` (none hit by the traces). Catalog items are built inline (server/catalog.json is not in the cloud copy). The parity traces are shots only (jumper/close/layup/ft from everywhere on the half court, made and missed, bank, swish, blacktop/wood, both ends); passes, tips and dunk flights use the same integrator but were not in the 1,000.
5. **Godot under lavapipe crashes on quit** after saving a frame (`Unreferenced static string`) — a software-renderer quirk; the capture scripts wait for the saved-frame line and kill the process. Not seen in `--headless` runs and not expected on a real GPU.

## What David does now

1. **Install** Godot 4.7.2 .NET (the "mono" build) and the .NET 8 SDK on the PC, open `C:\Afterhours16\rimrift\game\project.godot`, let it import, Build (the hammer icon) and press Play: the demo runs in the editor.
2. **Run the demo exe:** in `C:\Afterhours16\rimrift\dist\parts\`, double-click `JOIN.cmd`, extract `RIMRIFT-G0-spike.zip` anywhere, run `RIMRIFT-G0-spike.exe` (the `data_Rimrift_windows_x86_64` folder must stay next to it). Keys: 1–5 cameras, C cycle, **A adds ten athletes**, R resets, H hides the HUD, Esc quits. Read the fps line with 11 athletes on the gameplay camera: that number closes the last gate.
3. **Decide on athletes (roadmap decision 2 — "test MetaHuman in the spike").** The MetaHuman half of that decision could not be run from the cloud: generating a MetaHuman needs Unreal 5.6 + MetaHuman Creator on the PC and an Epic account, and the export for Godot is a manual step there. The spike's pipeline (skeleton, retarget, weights, glb, driver) takes any rigged glb, so a MetaHuman test is: David exports one MetaHuman body+face as glTF/FBX from Unreal, drops it in game/assets/athlete/, and the Character agent retargets it in a session. Options, honestly: (a) **MetaHuman bodies and faces** (licensed for Godot, free under $1M; needs Unreal 5.6 + Epic's cloud tools on the PC to author, then a retarget to our skeleton — the biggest visual jump, and the only route to the sheet's face quality); (b) **stay CC0** and buy the art time instead: a sculpted athletic body on the base mesh, hand-modelled garments with a cloth bake, hair cards, a face made in a DCC tool — Claude can drive Blender headless for most of it, but the face likeness and the body sculpt are where a human artist would be worth a day; (c) a **commercial base-body + clothing pack** with commercial rights (checked case by case). The spike's pipeline (skeleton, retarget, weights, glb, driver) is the same for all three.
4. Sign off (or not) on the park look at gameplay distance, and say whether the darker, higher-contrast concept-art grade is the goal for Stage 1.5 (it changes the lighting approach: HDRI sky + baked lightmaps).

## Next: Stage 1 (v0.4.9) kickoff, from the roadmap's plan of action

Six agents (rules, animation, athletes, gear, worlds, menus + online), rebuilt from the playbook. The spike leaves them: a proven port recipe (JsMath + bit-exact harness pattern; copy it for game.js/ai.js/player.js — 1.1), a proven animator port with the stub list as the work queue (1.2), the athlete pipeline scripts and the open body decision (1.3), the park generator pattern (layout export → C# MeshKit → Verify) for the Brick Yard, Foundry, event park, gym, arena and Crew HQ (1.5), and a demo scene/driver to grow the session into (1.7). Git LFS: `rimrift/.gitattributes` is in place — GitHub Desktop handles LFS; the first commit of rimrift/ will upload ~55 MB of binaries.
