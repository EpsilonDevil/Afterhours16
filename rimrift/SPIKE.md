# RIMRIFT Stage 0.5 spike — working contract for the agent team

Goal (G0 gate, from the roadmap): C# ball/shots/ratings/constants with a parity harness; Jolt ball-on-rim; Harbor
Point at sunset; one target-quality athlete driven by the ported procedural animator. Gate = ball parity exact
over 1,000 shots, no tunnelling at 20 m/s, 60 fps with 10 athletes on David's GPU, athlete sign-off.

## Layout (one Godot project, one solution)

```
rimrift/
  SPIKE.md                      this file
  game/                         the Godot 4.7.2 .NET project (project.godot, Rimrift.csproj, Rimrift.sln)
    scenes/                     .tscn (text). Spike.tscn = toolchain probe (lead). Agents add their own folders:
      harbor/   HarborPoint.tscn, JoltRimTest.tscn     (World agent)
      athlete/  Athlete.tscn, AthleteShowroom.tscn     (Character agent)
    scripts/                    C# Godot nodes (namespace Rimrift.*). world/ (World), anim/ (Character)
    assets/                     meshes, textures, glTF, HDRIs. world/ (World), athlete/ (Character). Binary → Git LFS
    shaders/                    .gdshader text files
  sim/
    Rimrift.Sim/                pure C# (net8.0, NO Godot reference) — the port of client/js/sim (Rules agent)
    Rimrift.Anim/               pure C# (net8.0, NO Godot reference) — the port of client/js/char animator/skeleton/pose (Character agent)
    Rimrift.Sim.Tests/          xUnit (Rules agent)
    Rimrift.Anim.Tests/         xUnit (Character agent)
  harness/                      parity harness: export_traces.mjs (Node) + Rimrift.Harness (C# console) (Rules agent)
  tools/                        blender scripts, bake scripts (whoever needs them; keep your own subfolder)
```

Coordinate system everywhere = the JS sim's: metres, y up, court long axis Z, rims at z = ±12.725 (COURT.hoopZ),
rim at y 3.05, character faces +Z, left side is +X. Godot is right-handed y-up too, so positions port 1:1; only check
the sign of Z when placing cameras (Godot cameras look down −Z).

## Toolchain (already installed by the lead, verified working)

- `export PATH=/home/claude/.dotnet:$PATH DOTNET_ROOT=/home/claude/.dotnet` at the top of every shell call. .NET SDK 8.0.426.
- `godot` = Godot 4.7.2 stable mono (headless-capable). Export templates installed. Import: `godot --headless --import game`.
- Build: `cd game && dotnet build -c Debug`. Pure libraries: `cd sim/Rimrift.Sim && dotnet build`; tests: `dotnet test`.
- Rendering in the cloud (Forward+ on Mesa lavapipe, ~14 s per launch incl. shader compile, real pixels):
  `RIMRIFT_PROBE_OUT=/abs/path.png xvfb-run -a -s "-screen 0 1280x720x24" godot --path game --rendering-driver vulkan --resolution 1280x720 scenes/Spike.tscn`
  (see scripts/SpikeProbe.cs for the save-a-frame-and-quit pattern; copy it, don't edit it). Audio errors (ALSA) are harmless.
  Look at every render you make (Read the PNG). Make contact sheets with PIL.
- Blender 4.5.3 LTS: `blender -b --python script.py` (headless). Pillow + numpy in python3. Node 22 for the JS side.
- No network from Godot. Downloads: curl works for public URLs (github release assets, blender.org, CC0 asset sites).
- Nothing here has a GPU: fps numbers in the cloud are meaningless; count triangles, draw calls and shader cost
  instead (RenderingServer.GetRenderingInfo) and leave fps for David's PC.

## Standing rules (from the project playbook, adapted)

- The repo is /home/claude/ah (a copy of C:\Afterhours16; the JS game source is client/js). Never modify client/,
  server/, data/ or tests/ — the JS game is the reference, read-only for this spike. No git commands.
- Everything you write goes under /home/claude/ah/rimrift in the folders assigned to you above. Edit a file another
  agent owns only with the Edit tool and only if you must; re-read first. Never rewrite someone else's file with Write.
  Files all three may touch: game/project.godot, game/Rimrift.csproj, game/Rimrift.sln — Edit tool only, minimal lines.
- Scratch: /tmp/claude-0/<your-agent-name>/ only. Temporary renders, downloads and experiments go there.
- Binary assets you keep must be under game/assets/<yours>/; keep the total under 150 MB per agent; name the source
  and licence of every downloaded asset in game/assets/<yours>/SOURCES.md (CC0 / own-made only — nothing with unclear
  rights, no Mixamo files in the repo).
- Determinism: everything in Rimrift.Sim and Rimrift.Anim is double-precision, fixed 60 Hz, no Godot types, no
  System.Random, no DateTime. The one RNG is the ported mulberry32 (Rng.cs).
- Tests: add tests for your own work and run them. At the end run the full `dotnet test` on the solution.
- Report back (your final message) with: what exists (file list), what is proven (test/harness output pasted),
  renders (paths), measurements for the G0 report, and what is NOT done. Honest, numbers first.

## Demo keys and env vars (fps test on David's PC)

`scenes/Demo.tscn` (Harbor Point + the animated athlete + the ported ball solver). Default body = the Meshy athlete (David's pick, Oct 19; the MetaHuman path stays selectable)
(`assets/athlete/metahuman/athlete_mh.glb`, card LOD1; the showroom `AthleteShowroomMH.tscn` keeps the LOD0-card glb).

- Keys: `1`–`6` cameras (poster, game, baseline, broadcast, rim, close) · `C` cycle · `A` +10 athletes (11 on court =
  the fps gate) · `R` reset the extras · `B` cycle the body for everyone (meshy → mh → cc0; respawns) · `L` cycle the
  groom LOD override (auto → 0 full → 1 hair-only → 2 helmet) · `H` toggle the HUD · `Esc` quit.
- HUD (one screenshot = the test result): fps + min-after-warm-up, athlete count, body, triangles, draw calls, the
  groom LOD counts (full / hair-only / helmet) and the camera-distance range with the thresholds.
- Env: `RIMRIFT_BODY=meshy|mh|cc0` (default meshy), `RIMRIFT_DEMO_EXTRAS=10`, `RIMRIFT_GROOM_LOD=auto|0|1|2`,
  `RIMRIFT_GLB=res://...` (any athlete, overrides the body), capture mode `RIMRIFT_DEMO_SHOTS="name:cam:seconds,..."`
  + `RIMRIFT_SHOT_DIR=/abs/dir`. `RIMRIFT_DEBUG_BONES=1` draws the animator's joints as unlit lines through the mesh
  (any athlete scene); the showroom takes extra capture cameras `RIMRIFT_SHOT_CAMS="name:ex,ey,ez:tx,ty,tz:fov;..."`
  and every capture logs `metrics` (elbow angles, wrist/fingertip heights, hand-to-ball). Look-dev (pass 3): `RIMRIFT_HUD=0`
  hides the HUD, `RIMRIFT_ATHLETE_MASK=1` draws every athlete as a flat magenta cut-out (exact athlete-pixel masks for
  measuring), `RIMRIFT_LOOKSET="Exposure=0.78,SunBearingDeg=40,FillColor=0.74;0.64;0.74,Ssil=true"` overrides any
  exported float/bool/colour of HarborPoint from the shell; `RIMRIFT_LOOK=novol,nofog,...` are the off switches. `AthleteDriver.Ball` is in
  the athlete's frame (what `Transform * Ball` draws); the driver converts it to world for the animator (fixed Oct 19:
  the Demo's shooter used to reach for a ball 6 m behind him — "the unnatural shooting arms").
- Groom distance LOD (camera → head joint): `AthleteDriver.GroomLodMid` (8 m: beard + brows hidden), `GroomLodFar`
  (18 m: hair cards → the helmet cap `HairHelmet`, from Epic's Helmet_LOD5), `GroomLodHysteresis` (1 m) — exported
  properties on the athlete scenes, tune them there.
