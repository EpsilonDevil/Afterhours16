# RIMRIFT Stage 1 direction (Oct 19, 2026): read before any port work

Owners' decision (David, with Claude as build lead). The Dec 18 gates were signed off by Cindy (R&D) on Oct 19, with edits that are folded in below. The full reasoning, shared with the team, is in the doc "RIMRIFT: Next Steps and Our Reasoning": https://claude.ai/code/artifact/b0469909-b71c-4a28-bf86-8a63ad0011b9. The same content is in project doc `claude/rimrift-next-steps-oct19.md`.

This file is the agents' working version. It sits beside SPIKE.md (the toolchain, layout and rules all still apply) and G0-REPORT.md (what's already proven).

## What changed

- **FIRST RUN, a limited public playtest, is in January 2027.**
  - The plan of record is **Option B**: a Godot graphics preview with today's gameplay.
  - **Option A**, the current web/.exe build, is the automatic fallback.
  - The internal go/no-go is **Fri Dec 18, 2026**. That date is internal only and never goes in anything public.
- **Stage 1 becomes slice-first.** The first target is the preview slice: one park (Harbor Point), 3v3 to 21, offline, with the match HUD and meter only. The rest of Stage 1 (other venues, the full menus, online) comes after the go/no-go.
- **Team input adopted:** Cindy (R&D) and Mark (Marketing). Their documents are linked in the doc above.

## Rules for every agent

- **Baseline.**
  - The port target is the frozen commit made after David pushes v0.4.8.6 quick patch 3 (the RIMRIFT rename). The lead names the commit in STATUS.md.
  - Re-hash the ported modules against it before you start. Quick patch 3 changed strings in sim/league.js and nothing else in sim/.
  - From then on the live game takes content updates only.
- **Rules stay bodyDims-based.** MetaHuman or any other mesh proportions never feed reach or other gameplay values.
- **Clearance (public-safe build).** Nothing below may appear anywhere in the Godot build:
  - commercial music (Tusk, Back in Black, Juice WRLD, Kendrick Lamar, the soundtrack MP3s);
  - real-person ability or badge names ("Oprah", "Sexy Red");
  - 2K terms ("VC", "2K Cam", MyPLAYER), including signs such as the Foundry's "VC STORE".
  
  Use the replacement names once David approves them. Until then, use neutral placeholders and keep internal IDs unchanged.
- **No mixed online play** between Godot and the live web build. The preview is offline. Progression comes from a ticketed game against the local Python service.

## Per role

**Rules (sim/Rimrift.Sim, harness/).**
- Port the match sim (game.js, ai.js, player.js, and every module they need) using the spike's recipe.
- Use JsMath for every transcendental and Math.round. Keep the JS expression structure.
- Use **stable sorts** (LINQ OrderBy or a merge sort), never Array.Sort or List.Sort.
- Keep Map/Set and object key iteration in insertion order.
- The parity check is a full-state hash of raw double bits on every tick, not stateHash's 1 mm rounding. Run it on 72 park and 24 Pro-Am seeds plus recorded human intent streams (the online wire format is the recorder).
- Add a command-line **parity mode** to the exported build. It runs the seeds and the recorded games headless and prints the per-tick hashes, so the gate runs on real Intel and AMD PCs.
- In weeks 1 to 2, run a 1-to-2-day **ClearScript test** as insurance: Microsoft.ClearScript.V8 hosting client/js/sim inside the C# process. It must run **inside an exported Windows build** at the sim's tick rate, not just in the editor. Measure packaging, per-tick interop cost and ES-module loading.
- **Checkpoint Nov 20:** if the full game isn't hash-equal on all 96 seeds by then, the preview runs the sim through ClearScript.

**Animation (sim/Rimrift.Anim, game/scripts/anim).**
- The bit-exact 21-bone procedural animator stays the source of motion and timing.
- Its output is retargeted onto the shared game skeleton (about 65 bones with fingers, plus jaw and eyes, twist bones, and ball-hand and IK sockets).
- Work through Animator.StubsHit for everything a match needs.
- Gate: 0 sim ticks of grading difference for every action type, checked automatically at simulated 60, 120 and 144 Hz with vsync on and off.
- Keep input frame-quantized, as the JS does.

**Athletes (game/assets/athlete, tools/athlete).**
- MetaHuman is the body source. David exports from UE 5.6 or later with MetaHuman Creator, via DCC Export to Blender and then GLB.
- Follow Cindy's graphics brief:
  - export deformation bones only, with backface culling on;
  - lock the surface order;
  - author LODs by hand (gameplay tier: face LOD3 at about 6.9k triangles); no Godot auto LOD on skinned meshes;
  - card hair with Alpha Hash plus alpha-to-coverage (MSAA ≥ 2×) and anisotropy;
  - Forward+ SSS skin, with the SRMF channels remapped;
  - parallax eyes;
  - ARKit-52 baked, with the RigLogic correctives stripped;
  - about 60 to 90 MB of VRAM per player.
- Fallback if MetaHuman is late: the improved CC0 body. The preview's athlete bar is "reads as the visual target at the gameplay camera". Don't use Character Creator 4: its licence needs Enterprise for an in-game creator.

**Worlds (game/scenes/harbor, game/scripts/world).**
- Harbor Point only for the preview.
- Keep the camera, FOV and court scale exactly as the JS has them; the spike already matches them.
- The look targets the concept art, not the WebGL build: an HDRI or proper sky, LightmapGI, a proper palm asset, one shadowed key light.
- The net stays procedural or bone-animated. No SoftBody3D before Stage 2.
- **A Low graphics preset by Dec 16**, tuned on PC 3:
    - lower shadow resolution;
    - SSAO and screen-space reflections off;
    - a lower render scale;
    - fewer hair card layers;
    - a stronger LOD bias;
    - 1K textures instead of 2K, so it fits a 4 GB card.
  
  Its full-game frame time on PC 3 is the minimum-spec gate's evidence.

**Menus and online (game/scripts/ui).**
- The match HUD and shot meter. The meter's maths stays in the sim layer and is diffed per frame against the JS.
- A minimal front end: pick a build from the service, play, and see the results with rewards. Rewards must persist after a restart. If the service isn't running or crashes, show a clear message, never a hang.
- Bundle an embedded Python runtime so testers don't need Python installed.

## Dec 18 gates (signed off by Cindy, Oct 19, with our three adjustments)

Every gate must pass, or FIRST RUN switches automatically to Option A. **Gate evidence is due Wed Dec 16**, so Dec 18 is a review of results, not a testing day. Pin the frozen commit SHA in every gate's evidence.

| Gate | Passes when | Owner |
| --- | --- | --- |
| Rules parity | Full-state raw-bits hash equal **on every tick**, on the frozen commit: 72 park + 24 Pro-Am seeds plus at least 10 recorded human games (at least 3 by David). Run it in the **exported release build** through a command-line parity mode, on an Intel and an AMD CPU. | Rules; Cindy reviews |
| Shot meter | **0 sim ticks** of grading difference for every action type. The on-screen meter may differ by one displayed frame at high refresh rates (presentation only). Test at 60/120/144 Hz with vsync on and off, by simulated frame pacing, plus the real monitors available. | Animation |
| Frame rate (target cards) | **p99 frame time ≤ 16.7 ms over a full game**, uncapped, at 1080p on PC 1 (RTX 2070 Super) and PC 2 (RX 6600), with 6 athletes plus park life. No shader-compile stutter on a first launch with the cache cleared. | Worlds + Athletes; David measures |
| Minimum spec (PC 3, GTX 1650 class) | On the **Low preset**: average ≥ 40 fps and **p99 frame time ≤ 25 ms** over a full game, measured on a second launch with a warm shader cache. First-launch stutter on PC 3 is **report-only**. **If it misses, the published minimum spec rises to the RX 6600 class; the preview does NOT fall back.** | Worlds; David measures |
| Feel | David plus a second tester. Not blind (the builds look different). Objective check: press-to-response ticks match the old build, and press-to-screen time is within 1 frame (phone slow-motion). | David + 1 tester |
| Athlete | Reads as the visual target at the gameplay camera with **either the MetaHuman or the improved CC0 body**. | Athletes; David signs off |
| Stability | **2 h unattended** back-to-back games on each of the 3 test PCs, no memory growth. A clean Windows account without dev tools on PC 2 proves the bundled Python and .NET. | Lead |
| Progression | A ticketed game updates rewards on a results screen; **rewards persist after a restart**. Service not running or crashed → a clear message, never a hang. | Menus and online |
| Clearance | An automated string scan of the exported build plus a check of the audio files and sign textures finds nothing restricted. A **third-party licence and attribution file** ships: Godot (MIT), the V8/fdlibm maths port (BSD / Sun), CC0 assets, fonts (OFL), MetaHuman licence terms. | Lead; Mark spot-checks |
| Delivery | A real Steam Playtest key installs on a clean PC (or there's a private link for Option A). A feedback and crash-report path is live. Samantha (support) is briefed on known issues. | David; Samantha |

**Test hardware (Cindy's final plan):**

| PC | Machine | Covers |
| --- | --- | --- |
| PC 1 | David's rig, RTX 2070 Super, kept on Windows 10 (security updates run to Oct 12, 2027) | Target card; Windows 10 testers |
| PC 2 | New AMD box with an RX 6600, arriving by early November | AMD CPU, the second target card, the clean Windows account |
| PC 3 | Used GTX 1650-class PC (4 GB of video memory), arriving soon | The minimum-spec gate and the Low preset |

The parity gate needs one Intel and one AMD CPU: PC 2 is AMD, so if PC 1 is AMD too, PC 3 is Intel.

**Checkpoints:**
- **Nov 20, rules parity:** full-game parity on all 96 seeds, or the preview switches to ClearScript. The switch is only possible if the Oct 26–Nov 1 ClearScript test proves it runs **inside an exported Windows build** at the sim's tick rate, not just in the editor.
- **Dec 11, fallback readiness:** the current build with the clearance patch passes the clearance, stability and delivery gates on its own.

## Schedule

| Workstream | Dates |
| --- | --- |
| Clearance patch to the live build (plus the input recorder, a test tool that doesn't touch the rules) | Oct 19 to Nov 1 |
| MetaHuman export (David) | Oct 19 to about Nov 15 |
| C# rules port | Oct 19 to Nov 20 |
| ClearScript test, inside an exported Windows build | Oct 26 to Nov 1 |
| Parity checkpoint (fixed) | Nov 20 |
| Rest of the preview slice | Nov 2 to Dec 11 |
| Fallback readiness (fixed) | Dec 11 |
| Gate evidence due (fixed) | Dec 16 |
| Go/no-go (fixed) | Dec 18 |
