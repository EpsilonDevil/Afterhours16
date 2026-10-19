# game/assets/world — sources and licences

Everything in this folder is self-made for RIMRIFT; nothing is downloaded. No third-party asset, no Mixamo, no HDRI.

| path | what | how it is made |
|---|---|---|
| harbor_layout.json | the Harbor Point layout (courts, hoops, fences, poles, benches, palms, shore, theme) | exported from the JS game by `tools/world/export_layout.mjs` (reads client/js read-only) |
| tex/*.png | court overlays, backboard markings, asphalt, sand, chain-link, frond, water normal, noise, rings, GOT NEXT | generated procedurally by `tools/world/make_textures.py` (Pillow + numpy); the court lines follow the exported court geometry |
| renders/*.png | reference renders of the Godot scene (poster, game, baseline, top) and the contact sheets | `game/scenes/harbor/HarborPoint.tscn` through `WorldProbe.cs`; the contact sheet also embeds the concept art kit/RIMRIFT/images/find-your-run-visual-target.png (David's own) and docs/renders/court-harbor.png (the JS game) |

All meshes are built at runtime by `scripts/world/MeshKit.cs` (no mesh files). Shaders in `game/shaders/world/` are written for this project.
