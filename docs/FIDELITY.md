# What v0.4.2 is (and isn't)

Afterhours 16 is an independent, original game built to capture the *feel* of 2015-era sim/arcade basketball: MyPARK-style social courts, Pro-Am 5v5 with a branded team, a VC economy and a timing-based shot meter. It is not a port, mod or recreation of NBA 2K16 and contains none of its code, assets, names or data.

| Area | What v0.4.2 does | Honest limit |
|---|---|---|
| Graphics | Custom WebGL2 HDR renderer: PBR, soft shadows, planar floor reflections, bloom, ACES, FXAA, instanced crowd, night/day parks, a branded arena with jumbotron and LED boards. v0.4 players use anthropometric proportions, sculpted torsos and limbs, five-finger hands, real eyeballs and lids, alpha-strand hair, detail normal maps and two-lobe skin specular | Procedural geometry, not scanned players. Faces still read as sculpted up close, and there are no wrinkle maps or cloth simulation. Visual quality scales with your GPU and the chosen tier |
| Animation | Procedural animation tuned to measured biomechanics (numbers below): velocity-matched gait, planted feet, IK hands that follow the real ball, landing absorption and a full action set (jumpers by release, layups, four dunk packages, hangs, blocks, steals, size-ups, ankle-breaks, celebrations) | Still no motion capture or blend tree; that is the v0.5 plan (`docs/V0.5-PLAN.md`) |
| Physics | Real ball flight (drag, spin), rim, backboard and floor collisions, cloth nets, momentum-based players with plant cuts and body bumps | Player contact is resolved as capsules and bumps, not a full-body ragdoll or contact-animation system |
| Shooting | Timed release. A green (Excellent) release always goes in unless blocked, and contest, movement, fades and range shrink the green window, which the meter shows live. Then the ball flies a physically consistent trajectory | Percentages are original balance targets (AI FG ≈ 40–46%), not 2K16's internal formula |
| Controls | Buffered input at a fixed 60 Hz, native controller support (Xbox/PlayStation/Switch Pro glyphs, right-stick dribble moves and attack-the-rim, rumble, menus), full keyboard and controller remapping, fullscreen keyboard lock-in, a Windows .exe launcher | Controllers go through the browser Gamepad API, so it needs Edge/Chrome for full support |
| AI | Utility-based offense (drive the open shoulder, kick-out, screens and rolls, cuts), help defense, closeouts, box-outs, reaction delays by difficulty | Heuristic AI, not a learned or play-call system. Real people are replaced by AI teammates and opponents (single player only) |
| MyPARK | Three affiliation parks, each with six live courts (three full-court 3v3, two 2v2, one 1v1), Got Next circles, squad filling, winners-stay, win streaks with growing VC/Rep multipliers, Rep tiers Rookie → Legend, an in-park VC Store, Boosts kiosk, Daily Spin wheel and a practice hoop | No other humans online. Park-goers are AI. No Ante Up or 1v1 stage area |
| Pro-Am | Team identity (name, abbr, colors, logo, floor) applied to court, LEDs, jumbotron and uniforms, 5v5 with full rules, saved team record | You play with an AI roster generated from your team seed, not a human squad |
| VC Store | 107 original items across apparel, shoes, accessories and animation packages, with try-on and unlock requirements by OVR, Rep or attribute | Original brands and silhouettes only. No licensed 2016 gear |
| Builds | Five positions, eight archetypes, body-driven caps across 22 attributes, VC upgrades, 18 badges with four tiers | Caps, costs and badge thresholds are original, chosen for balance |

## Measurements behind the motion (v0.4)

These ranges come from published jump-shot, running and landing biomechanics studies. The game uses values in or close to them.

| Motion | Measured range | Afterhours 16 |
|---|---|---|
| Jump shot: knee angle at the bottom of the dip | ~112–122° | ~115–118° (a little deeper from three) |
| Jump shot: centre-of-mass rise | ~15–31 cm | 52% of max vertical × the jumpshot base's jump factor (≈12–35 cm), ×0.9 beyond 7 m |
| Jump shot: release timing | just before the apex | takeoff is timed back from the release so the ball leaves the hand 90% of the way through the rise (near the top of the jump) |
| Jump shot: release height | ~1.31–1.38 × standing height | 0.93 × standing reach + jump height ≈ 1.28–1.40 × H |
| Jump shot: release angle | ~52–61° | 49–58° by release package |
| Gait: stance share of the stride (duty factor) | ~0.6 walking, ~0.35–0.4 jogging, ~0.22–0.3 sprinting | 0.62 / 0.36 / 0.26 |
| Gait: step length | grows with speed and height | walk 0.26 + 0.33·v m, run 0.62 + 0.17·v m (× height / 1.8 m) |
| Gait: centre of mass | walking vaults (high at mid-stance), running bounces (low at mid-stance) | ~3.5 cm walking, ~5–7.5 cm running, phased accordingly |
| Gait: swing leg | knee flexion up to ~130–140° when sprinting (heel recovery) | the swing ankle rises 0.11 m walking to ~0.5 m sprinting, peaking early in the swing |
| Landing | knees absorb in proportion to the impact speed | a spring-damper on hip height (ω 13 rad/s, ζ 0.72) kicked by the touchdown speed; a 25 cm jumper lands at ~128° knee |
| Ball | regulation ball: ~0.76–0.88 floor restitution, drag and Magnus lift; a flexing rim | wood 0.80, asphalt 0.74, rim 0.50–0.62 with a small deterministic deflection per contact, glass 0.62, quadratic drag and spin lift |

## Inspiration, not imitation

The references used to shape the design were public descriptions of how 2K16-era modes worked: three affiliation parks, a walk-up Got Next flow, team-branded Pro-Am, VC-bought attributes and gear, and a release-timed jumper. The developers' public remarks that weight and height should affect cuts, stops and foot planting directly shaped the movement model here. Every name, logo, court, item, number and formula in the game is original.
