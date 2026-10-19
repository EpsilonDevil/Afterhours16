// Ports of the ball / shot-model assertions in tests/sim.test.mjs, final.test.mjs, qp2.test.mjs, stage7.test.mjs,
// park.test.mjs and finish.test.mjs that run on shots.js / ball.js / ratings.js / constants.js alone (no Game).
using Rimrift.Sim;
using Xunit;
using static Rimrift.Sim.Shots;
using static Rimrift.Sim.Ratings;

namespace Rimrift.Sim.Tests;

public class BallShotsTests
{
    // sim.test.mjs: 'planned makes go in and planned misses stay out, from every spot on both ends'
    [Fact]
    public void Planned_makes_go_in_and_planned_misses_stay_out_from_every_spot_on_both_ends()
    {
        var rng = new Rng(11);
        foreach (int side in new[] { 1, -1 })
        {
            var rim = Constants.rimPos(side);
            int made = 0, missed = 0;
            for (int i = 0; i < 60; i++)
            {
                double d = 0.8 + rng.Next() * 7.8, a = (rng.Next() - 0.5) * JsMath.PI * 0.95;
                var P = new Vec3(rim.x + JsMath.Sin(a) * d, 2.4 + rng.Next() * 0.5, rim.z - side * JsMath.Cos(a) * d);
                if (planShot(rng, P, rim, side, true, 50).made) made++;
                if (!planShot(rng, P, rim, side, false, 50).made) missed++;
            }
            Assert.True(made >= 59, $"side {side}: {made}/60 makes resolved");
            Assert.True(missed >= 59, $"side {side}: {missed}/60 misses resolved");
        }
    }

    [Fact]
    public void Ball_flight_is_deterministic_and_scores_through_the_ring()
    {
        var rim = Constants.rimPos(1);
        var P = new Vec3(1.5, 2.6, rim.z - 5);
        var plan = planShot(new Rng(21), P, rim, 1, true, 52, new PlanOpts { swish = true, guarantee = true });
        Assert.True(plan.made);
        Ball Make()
        {
            var b = new Ball();
            b.setFlight(P.x, P.y, P.z, plan.vx, plan.vy, plan.vz, "shot", null);
            b.wx = plan.wx; b.wy = plan.wy; b.wz = plan.wz;
            return b;
        }
        var b1 = Make(); var b2 = Make();
        var ev = new List<BallEvent>();
        bool through = false;
        for (int i = 0; i < 300; i++)
        {
            ev.Clear(); b1.step(Constants.DT, ev); b2.step(Constants.DT, null);
            Assert.Equal(b1.snapshot(), b2.snapshot());
            foreach (var e in ev) if (e.Type == "through") { through = true; Assert.Equal(1, e.Side); }
        }
        Assert.True(through || plan.ghost, "a planned swish goes through the +z ring");
        Assert.Equal(1, b1.scoredFlag);
    }

    [Fact]
    public void Rim_contact_flags_and_events_fire()
    {
        // drop the ball straight onto the front of the rim
        var b = new Ball { halfOnly = true };
        b.setFlight(0, COURT.rimY + 0.6, COURT.hoopZ - Ball.RT, 0, -3, 0, "shot", null);
        var ev = new List<BallEvent>();
        for (int i = 0; i < 60; i++) b.step(Constants.DT, ev);
        Assert.True(b.touchedRim);
        Assert.Contains(ev, e => e.Type == "rim" && e.V > 0.25);
        // and onto the glass
        var g = new Ball { halfOnly = true };
        g.setFlight(0.5, 3.4, COURT.boardZ - 0.5, 0, 0, 6, "shot", null);
        ev.Clear();
        for (int i = 0; i < 30; i++) g.step(Constants.DT, ev);
        Assert.True(g.touchedBoard);
        Assert.Contains(ev, e => e.Type == "board");
        Assert.True(g.vz < 0, "bounced back off the board");
    }

    [Fact]
    public void Floor_bounce_loses_energy_and_counts()
    {
        var b = new Ball { halfOnly = true };
        b.setFlight(0, 1.5, 0, 0, 0, 0, "loose", null);
        var ev = new List<BallEvent>();
        for (int i = 0; i < 120; i++) b.step(Constants.DT, ev);
        Assert.True(b.floorBounces >= 1);
        Assert.Contains(ev, e => e.Type == "bounce");
        Assert.True(b.y < 1.5);
    }

    [Fact]
    public void Court_geometry_helpers()
    {
        // stage7.test.mjs: out of bounds, regulation style
        double W = COURT.width / 2, L = COURT.length / 2;
        Assert.False(Constants.ballOut(W - 0.001, 0));
        Assert.True(Constants.ballOut(W, 0));
        Assert.True(Constants.ballOut(0, L));
        Assert.True(Constants.ballOut(0, -0.05, true));
        Assert.False(Constants.ballOut(0, 0.05, true));
        Assert.False(Constants.feetOut(W - Constants.FOOT_R - 0.001, 0));
        Assert.True(Constants.feetOut(W - Constants.FOOT_R + 0.001, 0));
        Assert.True(Constants.feetOut(0, L - Constants.FOOT_R + 0.001));
        Assert.True(Constants.feetOut(0, Constants.FOOT_R - 0.001, true));
        // three-point line: corners and the arc, both ends
        Assert.True(Constants.isThree(6.8, COURT.hoopZ - 0.5, 1));
        Assert.False(Constants.isThree(6.5, COURT.hoopZ - 0.5, 1));
        Assert.True(Constants.isThree(0, COURT.hoopZ - 7.3, 1));
        Assert.False(Constants.isThree(0, COURT.hoopZ - 7.1, 1));
        Assert.True(Constants.isThree(0, -COURT.hoopZ + 7.3, -1));
        Assert.True(Constants.inLane(0, COURT.hoopZ, 1));
        Assert.False(Constants.inLane(3, COURT.hoopZ, 1));
        Assert.True(Constants.inBounds(0, 0));
    }

    // sim.test.mjs v0.4.4 rating curve + qp2 proficiency
    [Fact]
    public void Rating_curve_is_steep_under_70_buffed_past_95_and_near_automatic_at_99()
    {
        for (int v = 41; v <= 99; v++) Assert.True(timingWindowMs(v) >= timingWindowMs(v - 1), $"window grows with the rating ({v})");
        Assert.True(greenWindowMs(55) < greenWindowMs(70) * 0.7);
        Assert.True(timingWindowMs(99) > timingWindowMs(95) * 1.5);
        Assert.True(rk(99) - rk(95) > rk(95) - rk(85));
        foreach (var v in new[] { 40, 55, 69 }) Assert.True(Math.Abs(rk(v) - rkRaw(v) * SUB70_K) < 1e-12);
        foreach (var v in new[] { 70, 85, 99 }) Assert.Equal(rk(v), rkRaw(v));
        Assert.True(rk(69) < rk(70) * 0.9);
        Attrs a(double v) => Attrs.Of(("three_point", v), ("mid_range", v), ("layup", v), ("free_throw", v), ("close_shot", v), ("driving_dunk", v), ("standing_dunk", v));
        double fc(double v, string type, bool three, double d, string? grade, double contest) => finalChance(new ChanceOpts { stamina = 1, badges = new Badges(), a = a(v), type = type, three = three, d = d, grade = grade, contest = contest });
        Assert.True(fc(99, "jumper", true, 7.4, "none", 0) >= 0.89, "an untimed open 99 three is still ~90%");
        Assert.True(fc(99, "jumper", true, 7.4, "early", 0) <= 0.03, "slightly off: 3% at most");
        Assert.True(fc(99, "layup", false, 1.4, null, 0) >= 0.96, "open 99 layup");
        Assert.True(fc(99, "layup", false, 1.4, null, 1) < 0.8, "a good contest still brings a 99 down");
        Assert.True(fc(99, "jumper", true, 7.4, "vlate", 0) < 0.5, "badly mistimed is still bad");
    }

    // final.test.mjs / qp2.test.mjs / stage7.test.mjs: the window identities
    [Fact]
    public void Green_windows_carry_every_cut()
    {
        Assert.True(Math.Abs(GREEN_K - 0.9 * 0.935 * 0.9) < 1e-12);
        foreach (var v in new[] { 55, 75, 90 })
        {
            double sub = v < 70 ? 0.9 : 1;
            Assert.True(Math.Abs(greenWindowMs(v) - Math.Max(9, timingWindowMs(v) * sub) * GREEN_K) < 1e-9);
            Assert.True(Math.Abs(greenWindowMs(v, new Badges(), new ShotCtx { ft = true }) - timingWindowMs(v) * sub * 1.15 * GREEN_K) < 1e-9);
            Assert.True(Math.Abs(layupWindowMs(v) - Math.Max(9, timingWindowMs(v) * LAYUP_WIN_K * sub) * GREEN_K) < 1e-9);
        }
        Assert.Equal(0, greenWindowMs(90, new Badges(), new ShotCtx { contest = SMOTHER }));
        Assert.Equal(0, greenWindowMs(99, Badges.Of(("limitless", 4)), new ShotCtx { three = true, d = 45 * 0.3048 }));
        for (int v = 41; v <= 99; v++) Assert.True(layupWindowMs(v) >= layupWindowMs(v - 1));
        Assert.True(layupWindowMs(90, new Badges(), new ShotCtx { contest = 1 }) < layupWindowMs(90) * 0.7, "traffic shrinks it");
        Assert.True(layupWindowMs(90, new Badges(), new ShotCtx { contest = 1.2 }) > 0, "but never takes it away");
        double fcl(string grade) => finalChance(new ChanceOpts { type = "layup", d = 1.2, a = Attrs.Of(("layup", 80)), contest = 0.8, stamina = 1, badges = new Badges(), grade = grade });
        Assert.True(fcl("excellent") > fcl("none") + 0.15 && fcl("excellent") < 0.97);
        Assert.True(fcl("early") < fcl("none") && fcl("vlate") < fcl("early"));
    }

    [Fact]
    public void Jumper_timing_and_grades()
    {
        Assert.True(jumperTimingK(new ShotCtx { moving = 4 }) < jumperTimingK());
        Assert.True(jumperTimingK(new ShotCtx { stepback = true }) > jumperTimingK(new ShotCtx { fade = true }) && jumperTimingK(new ShotCtx { fade = true }) > jumperTimingK());
        Assert.True(jumperTimingK(new ShotCtx { three = true }) > jumperTimingK());
        Assert.Equal("excellent", gradeFromWindow(0.01, 30));
        Assert.Equal("early", gradeFromWindow(-0.05, 30));
        Assert.Equal("vlate", gradeFromWindow(0.3, 30));
        Assert.Equal("late", gradeFromWindow(0.05, 0)); // no window: within 75 ms is still only 'late'
    }

    // final.test.mjs: layups react to the coverage
    [Fact]
    public void Layup_coverage_reads_the_defense()
    {
        var p = new SimPlayer { x = 0, z = 9 }; var rim = new Vec3(0, COURT.rimY, 12.7);
        SimPlayer d(double x, double z, double vz = 0) => new() { x = x, z = z, vz = vz };
        Assert.Equal("open", layupCoverage(p, rim, Array.Empty<SimPlayer>()).kind);
        Assert.Equal("rim", layupCoverage(p, rim, new[] { d(0.3, 12.2) }).kind);
        Assert.Equal("front", layupCoverage(p, rim, new[] { d(0, 10.1) }).kind);
        var side = layupCoverage(p, rim, new[] { d(1.0, 9.6) });
        Assert.Equal("side", side.kind);
        Assert.Equal(-side.side, layupCoverage(p, rim, new[] { d(-1.0, 9.6) }).side);
        Assert.Equal("trail", layupCoverage(p, rim, new[] { d(0.2, 8, 4) }).kind);
        Assert.Equal("open", layupCoverage(p, rim, new[] { d(0.2, 8, 0) }).kind);
        Assert.Equal("L", layupHand("side", 1)); Assert.Equal("R", layupHand("open", null));
        Assert.Equal(LAYUP_COVER.Count, LAYUP_COVER.Values.Distinct().Count());
        Assert.Equal(LAYUP_FEEL.Count, LAYUP_FEEL.Values.Select(f => f.rel).Distinct().Count());
    }

    // sim.test.mjs v0.4.1 + finish.test.mjs: driving finishes
    [Fact]
    public void Driving_finishes_the_highest_rating_wins_the_defense_adjusts_it()
    {
        SimPlayer mk(params (string, double)[] r)
        {
            var a = Attrs.Of(("driving_dunk", 80), ("layup", 75), ("mid_range", 70), ("block", 50));
            foreach (var (k, v) in r) a[k] = v;
            return new SimPlayer { ratings = a, phys = new Phys { reach = 2.65, vertical = 0.75 }, badges = new Badges(), stamina = 1, x = 0, z = 0, vx = 0, vz = 5 };
        }
        var open = new Coverage { open = true };
        Assert.Equal("dunk", pickFinish(mk(), 3, open, true));
        Assert.Equal("layup", pickFinish(mk(("driving_dunk", 60), ("layup", 90)), 3, open, true));
        Assert.Equal("layup", pickFinish(mk(), 3, open, false));
        var protector = new SimPlayer { ratings = Attrs.Of(("block", 95)), phys = new Phys { reach = 2.9 } };
        Assert.Equal("layup", pickFinish(mk(("driving_dunk", 78), ("layup", 78)), 3, new Coverage { rimProtector = protector }, true));
        Assert.Equal("jumper", pickFinish(mk(("driving_dunk", 60), ("layup", 60), ("mid_range", 92)), 4, new Coverage { wall = new SimPlayer() }, true));
        var p = mk(); var rim = new Vec3(0, COURT.rimY, 3);
        Assert.Equal("dunk", shotTypeFor(p, rim, attack: true).type);
        Assert.Equal("none", shotTypeFor(p, new Vec3(0, COURT.rimY, 9), attack: true).type);
        // finish.test.mjs: an exact tie goes to the archetype
        SimPlayer driver(string arch, params (string, double)[] r)
        {
            var d = mk(r); d.entry = new Entry { build = new Build { archetype = arch } }; return d;
        }
        Assert.Equal("dunk", pickFinish(driver("slasher", ("driving_dunk", 99), ("layup", 99)), 3, open, true));
        Assert.Equal("layup", pickFinish(driver("playmaker", ("driving_dunk", 99), ("layup", 99)), 3, open, true));
        Assert.Equal("layup", pickFinish(driver("slasher", ("driving_dunk", 90), ("layup", 93)), 3, open, true));
        Assert.Equal("dunk", pickFinish(driver("playmaker", ("driving_dunk", 93), ("layup", 90)), 3, open, true));
        Assert.Equal("jumper", pickFinish(driver("sharpshooter", ("driving_dunk", 70), ("layup", 75), ("mid_range", 95)), 4, open, true));
    }

    // sim.test.mjs v0.4.3: interior D and size own the paint, perimeter D the arc
    [Fact]
    public void Contest_interior_D_owns_the_paint_perimeter_D_the_arc()
    {
        SimPlayer mk(double h, double x, double z, params (string, double)[] r)
        {
            var a = Attrs.Of(("interior_d", 60), ("block", 60), ("perimeter_d", 60), ("strength", 60));
            foreach (var (k, v) in r) a[k] = v;
            var b = new Build { height = h, weight = 180 + (h - 72) * 7, wingspan = h + 3, attributes = a };
            return new SimPlayer { ratings = a, badges = new Badges(), phys = physical(b), x = x, z = z, y = 0, handsUp = true };
        }
        var rim = new Vec3(0, COURT.rimY, 12.7);
        SimPlayer shooterAt(double d) => new() { x = 0, z = 12.7 - d, phys = new Phys { reach = 2.5 } };
        double paintBig = contestFor(shooterAt(1.5), new[] { mk(85, 0, 12.7 - 0.6, ("interior_d", 95), ("block", 92), ("perimeter_d", 50)) }, rim, 2.9);
        double paintGuard = contestFor(shooterAt(1.5), new[] { mk(74, 0, 12.7 - 0.6, ("interior_d", 45), ("block", 40), ("perimeter_d", 50)) }, rim, 2.9);
        Assert.True(paintBig > paintGuard * 1.25, $"paint: big {paintBig:0.00} vs guard {paintGuard:0.00}");
        double arcLock = contestFor(shooterAt(7.5), new[] { mk(76, 0, 12.7 - 6.4, ("perimeter_d", 95), ("interior_d", 45)) }, rim, 2.7);
        double arcSieve = contestFor(shooterAt(7.5), new[] { mk(76, 0, 12.7 - 6.4, ("perimeter_d", 45), ("interior_d", 45)) }, rim, 2.7);
        Assert.True(arcLock > arcSieve * 1.2, $"arc: lockdown {arcLock:0.00} vs {arcSieve:0.00}");
    }

    // park.test.mjs / sim.test.mjs: dunk spin; jumpshot packages
    [Fact]
    public void Dunk_spin_and_jumpshot_packages()
    {
        PlayerAction a(string style, double t, double slam = 0.9) => new() { type = "dunk", style = style, takeoff = 0.3, slam = slam, t = t, spinDir = 1 };
        Assert.Equal(0, dunkSpin(a("power", 0.6)));
        Assert.True(Math.Abs(dunkSpin(a("180", 0.78)) - JsMath.PI) < 0.02, "half turn by the slam");
        Assert.True(Math.Abs(dunkSpin(a("360", 0.84)) - JsMath.PI * 2) < 0.02, "full turn by the slam");
        Assert.True(dunkSpin(a("180", 0.32)) < 0.2, "still square at takeoff");
        Assert.True(Math.Abs(dunkSpin(a("360", 0.65, 1.0))) > 1);
        Assert.True(Math.Abs(dunkSpin(a("360", 1.2, 1.0)) - JsMath.PI * 2) < 1e-6);
        Assert.True(Math.Abs(dunkSpin(a("hs_sling", 1.0, 1.0)) - JsMath.PI * 2) < 1e-6, "the Hash Sling turns once");
        Assert.Equal(new[] { 0.0, 1, 2, 3 }, new[] { "dunk_basic", "dunk_tomahawk", "dunk_windmill", "dunk_flight" }.Select(k => DUNK_TIER[k]));
        var catalog = new Dictionary<string, CatalogItem>
        {
            ["js_base_standard"] = new() { id = "js_base_standard", style = "standard" },
            ["js_base_flick"] = new() { id = "js_base_flick", style = "flick" },
            ["js_base_skyline"] = new() { id = "js_base_skyline", style = "high", set_height = 1.15 },
            ["js_base_push"] = new() { id = "js_base_push", style = "push" },
            ["js_base_leanback"] = new() { id = "js_base_leanback", style = "lean" },
            ["release_classic"] = new() { id = "release_classic", release_seconds = 0.72 },
            ["js_base_sharpeye"] = new() { id = "js_base_sharpeye", style = "sharpeye", icon = "sharp_eye", jump = 1.5 },
        };
        ShotPkg pk(string id) => jumpshotPackage(new Build { equipment = new() { ["jumpshot"] = id, ["release"] = "release_classic" } }, catalog);
        Assert.True(pk("js_base_flick").tRel < pk("js_base_standard").tRel && pk("js_base_skyline").tRel > pk("js_base_standard").tRel);
        Assert.True(pk("js_base_push").winK > 1 && pk("js_base_leanback").winK < 1 && pk("js_base_skyline").relK > pk("js_base_push").relK);
        Assert.Equal("classic", pk("js_base_standard").release);
        Assert.Equal("standard", pk("js_base_sharpeye").style); // an Icon base only plays for its holder
        Assert.Equal("sharpeye", jumpshotPackage(new Build { icon_badge = "sharp_eye", equipment = new() { ["jumpshot"] = "js_base_sharpeye" } }, catalog).style);
        var hop = jumperHop(pk("js_base_standard"), 0.8, 0.62);
        Assert.True(hop.jumpH > 0 && hop.takeoff >= 0.2 && hop.showK == 0);
    }

    // sim.test.mjs: badges and effective ratings
    [Fact]
    public void Effective_ratings_and_icon_badges()
    {
        var raw = Attrs.Of(("three_point", 85), ("driving_dunk", 80));
        var none = BadgesModel.effectiveRatings(raw, new Badges());
        var shooter = BadgesModel.effectiveRatings(raw, Badges.Of(("catch_shoot", 1)));
        Assert.Equal(85, shooter["three_point"]);
        Assert.True(Math.Abs(rk(none["three_point"]) / rk(85) - 0.9) < 0.03, "about 10% less effective without a badge");
        var icon = BadgesModel.effectiveRatings(Attrs.Of(("three_point", 85), ("driving_dunk", 99)), Badges.Of(("posterizer", 4)), "hash_slinging");
        Assert.True(icon["driving_dunk"] > 99 && rk(icon["driving_dunk"]) > rk(99), "Icon badge scales past 99");
        Assert.Equal(new[] { 0, 1, 2.1, 3.31, 4.641 }, BadgesModel.BADGE_K);
        Assert.Equal(4.641, BadgesModel.bk(Badges.Of(("deadeye", 4)), "deadeye"));
        Assert.Equal(0, BadgesModel.bk(null, "deadeye"));
    }

    // qp2.test.mjs: physical attributes under 70
    [Fact]
    public void Physical_and_overall()
    {
        Phys ph(double v) => physical(new Build { height = 78, weight = 210, wingspan = 82, attributes = Attrs.Of(("speed", v), ("acceleration", v), ("vertical", v), ("strength", v), ("stamina", v)) });
        Assert.True(ph(69).sprint < ph(70).sprint && ph(69).vertical < ph(70).vertical);
        Assert.True(ph(99).sprint > ph(95).sprint);
        var p = ph(80);
        Assert.True(p.reach > 2.4 && p.reach < 2.8, $"standing reach {p.reach}");
        Assert.Equal(78 * Constants.INCH, p.H);
        var attrs = new Attrs(); foreach (var k in ATTRS) attrs[k] = 75;
        Assert.Equal(81, overall(attrs, "PG"));
        Assert.Equal(99, overall(new Attrs(ATTRS.Select(k => new KeyValuePair<string, double>(k, 99))), "C"));
    }
}
