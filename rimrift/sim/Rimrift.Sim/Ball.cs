// Port of client/js/sim/ball.js: basketball rigid-body flight: gravity, drag, Magnus, rim torus, glass, floor, net
// damping, score detection. Statement for statement; every Math.* call goes through JsMath where V8 and .NET differ.
namespace Rimrift.Sim;

public sealed class BallEvent
{
    public string Type = "";   // through | net | bounce | rim | board
    public int Side;           // through / net / rim / board
    public bool Clean, Rim;    // through
    public double V, X, Y, Z;  // bounce (x,z,v) / rim (v,x,y,z) / board (v)

    public override string ToString() => Type switch
    {
        "through" => $"through side={Side} clean={Clean} rim={Rim}",
        "net" => $"net side={Side}",
        "bounce" => $"bounce x={X:R} z={Z:R} v={V:R}",
        "rim" => $"rim side={Side} v={V:R} x={X:R} y={Y:R} z={Z:R}",
        "board" => $"board side={Side} v={V:R}",
        _ => Type,
    };
}

public readonly record struct BallSnapshot(double x, double y, double z, double vx, double vy, double vz, double wx, double wy, double wz);

public sealed class Ball
{
    public const double RT = COURT.rimR + COURT.rimTube; // torus centerline radius
    public const int SUB = 4;
    /// <summary>Sub-steps per step. 4 is the JS value (parity); the harness raises it only to measure tunnelling.</summary>
    public int Sub = SUB;

    public double x = 0, y = 1, z = 0;
    public double vx = 0, vy = 0, vz = 0;
    public double wx = 0, wy = 0, wz = 0; // spin rad/s
    public string mode = "dead"; // held | dribble | flight | dead
    public int holder = -1;
    public string? kind = null; // shot | pass | loose
    public object? info = null;
    public int lastTouch = -1, lastTeam = -1;
    public bool touchedRim = false, touchedBoard = false;
    public int floorBounces = 0;
    public string surface = "wood";
    public bool halfOnly = false; // park: only +z hoop exists
    public int scoredFlag = 0;
    public double flightTime = 0; // (undefined in JS until the first step/setFlight; `|| 0` makes that 0)
    public bool ghost = false;
    public bool netTouched = false;

    public void setFlight(double x, double y, double z, double vx, double vy, double vz, string kind, object? info)
    {
        this.x = x; this.y = y; this.z = z; this.vx = vx; this.vy = vy; this.vz = vz; mode = "flight"; holder = -1; this.kind = kind; this.info = info;
        touchedRim = false; touchedBoard = false; floorBounces = 0; scoredFlag = 0;
        flightTime = 0; ghost = false;
    }

    public BallSnapshot snapshot() => new(x, y, z, vx, vy, vz, wx, wy, wz);

    /// <summary>Step free flight by dt; appends events (may be null).</summary>
    public void step(double dt, List<BallEvent>? events)
    {
        double h = dt / Sub;
        for (int i = 0; i < Sub; i++) substep(h, events);
        flightTime = flightTime + dt;
    }

    public void substep(double h, List<BallEvent>? events)
    {
        double r = Constants.BALL_R;
        // forces
        double sp = JsMath.Hypot(vx, vy, vz);
        double kd = 0.0185;
        double ax = -kd * sp * vx, ay = -Constants.GRAVITY - kd * sp * vy, az = -kd * sp * vz;
        double km = 0.0032; // Magnus ω × v
        ax += km * (wy * vz - wz * vy);
        ay += km * (wz * vx - wx * vz);
        az += km * (wx * vy - wy * vx);
        vx += ax * h; vy += ay * h; vz += az * h;
        double py = y;
        x += vx * h; y += vy * h; z += vz * h;
        // hoops
        int nSides = halfOnly ? 1 : 2;
        for (int si = 0; si < nSides; si++)
        {
            int side = si == 0 ? 1 : -1;
            double cz = side * COURT.hoopZ, cy = COURT.rimY;
            // score detection: crossing rim plane downward inside the ring
            if (py >= cy && y < cy && vy < 0)
            {
                double d = JsMath.Hypot(x, z - cz);
                if (d < COURT.rimR - 0.035)
                {
                    scoredFlag = side;
                    events?.Add(new BallEvent { Type = "through", Side = side, Clean = !touchedRim && !touchedBoard, Rim = touchedRim });
                }
            }
            if (!ghost) { collideRim(side, cz, cy, events); collideBoard(side, events); }
            // net: funnel and slow the ball under the rim
            double dn = JsMath.Hypot(x, z - cz);
            if (y < cy && y > cy - 0.45 && dn < COURT.rimR && vy < 0)
            {
                double k = JsMath.Exp(-5.5 * h);
                vx *= k; vz *= k; vy *= JsMath.Exp(-2.2 * h);
                vx += -x * 9 * h; vz += -(z - cz) * 9 * h;
                if (!netTouched) { netTouched = true; events?.Add(new BallEvent { Type = "net", Side = side }); }
            }
            else if (y < cy - 0.6) netTouched = false;
        }
        // floor
        if (y < r)
        {
            y = r;
            if (vy < 0)
            {
                double e = surface == "wood" ? 0.8 : 0.74;
                double impact = -vy;
                vy = impact > 0.35 ? impact * e : 0;
                // friction & spin coupling
                double f = 0.86;
                double rollX = vx + wz * r * 0.4, rollZ = vz - wx * r * 0.4;
                vx = rollX * f; vz = rollZ * f;
                wx = vz / r * 0.5; wz = -vx / r * 0.5;
                floorBounces++;
                if (impact > 0.6) events?.Add(new BallEvent { Type = "bounce", X = x, Z = z, V = impact });
            }
            if (vy == 0)
            { // rolling
                double k = JsMath.Exp(-0.6 * h);
                vx *= k; vz *= k;
                wx = vz / r; wz = -vx / r;
            }
        }
        // spin decay
        double sk = JsMath.Exp(-0.15 * h);
        wx *= sk; wy *= sk; wz *= sk;
    }

    static double hsh(double v) { double s = JsMath.Sin(v) * 43758.5453; return s - Math.Floor(s); }

    public void collideRim(int side, double cz, double cy, List<BallEvent>? events)
    {
        double r = Constants.BALL_R, rt = COURT.rimTube;
        double dx = x, dz = z - cz;
        double dh = JsMath.Hypot(dx, dz);
        if (dh > RT + r + 0.05 || Math.Abs(y - cy) > r + 0.05) return;
        double qx, qz;
        if (dh < 1e-5) { qx = RT; qz = 0; } else { qx = dx / dh * RT; qz = dz / dh * RT; }
        // the connector side (toward board) is part of the rim too
        double px = x - qx, py = y - cy, pz = z - (cz + qz);
        double dist = JsMath.Hypot(px, py, pz);
        if (dist < r + rt && dist > 1e-6)
        {
            double nx = px / dist, ny = py / dist, nz = pz / dist;
            double pen = r + rt - dist;
            x += nx * pen; y += ny * pen; z += nz * pen;
            double vn = vx * nx + vy * ny + vz * nz;
            if (vn < 0)
            {
                // v0.4.2: the ring flexes; a deterministic hash of the contact point jitters the normal
                double j1 = hsh(x * 127.1 + z * 311.7 + y * 74.7) - 0.5, j2 = hsh(x * 269.5 + z * 183.3 + y * 246.1) - 0.5;
                double tl0 = JsMath.Hypot(-nz, nx);
                double tl = (tl0 == 0 || double.IsNaN(tl0)) ? 1 : tl0; // `|| 1`
                double mx = nx + (-nz / tl) * j1 * 0.22, my = ny + j2 * 0.12, mz = nz + (nx / tl) * j1 * 0.22;
                double ml = JsMath.Hypot(mx, my, mz); mx /= ml; my /= ml; mz /= ml;
                double vm = vx * mx + vy * my + vz * mz;
                double e = 0.5 + 0.12 * (hsh(x * 13.3 + z * 7.7)) - Math.Min(0.08, -vn * 0.008);
                if (vm < 0) { vx -= (1 + e) * vm * mx; vy -= (1 + e) * vm * my; vz -= (1 + e) * vm * mz; }
                else { vx -= (1 + e) * vn * nx; vy -= (1 + e) * vn * ny; vz -= (1 + e) * vn * nz; }
                // tangential friction
                double vn2 = vx * nx + vy * ny + vz * nz;
                double tx = vx - vn2 * nx, ty = vy - vn2 * ny, tz = vz - vn2 * nz;
                double f = 0.9;
                vx = vn2 * nx + tx * f; vy = vn2 * ny + ty * f; vz = vn2 * nz + tz * f;
                // spin from glancing contact
                wx += (ny * tz - nz * ty) * 4; wy += (nz * tx - nx * tz) * 4; wz += (nx * ty - ny * tx) * 4;
                touchedRim = true;
                if (-vn > 0.25) events?.Add(new BallEvent { Type = "rim", Side = side, V = -vn, X = x, Y = y, Z = z });
            }
        }
        // rim connector/bracket box behind the ring (toward glass)
        double backZ0 = cz + side * RT, backZ1 = side * COURT.boardZ;
        double zmin = Math.Min(backZ0, backZ1), zmax = Math.Max(backZ0, backZ1);
        if (Math.Abs(x) < 0.06 + r && z > zmin - r && z < zmax + r && y > cy - 0.03 - r && y < cy + 0.01 + r && Math.Abs(x) < 0.06 + r * 0.5)
        {
            if (vy < 0 && y > cy) { y = cy + 0.01 + r; vy = -vy * 0.45; touchedRim = true; events?.Add(new BallEvent { Type = "rim", Side = side, V = 1, X = x, Y = y, Z = z }); }
        }
    }

    public void collideBoard(int side, List<BallEvent>? events)
    {
        double r = Constants.BALL_R;
        double face = side * COURT.boardZ; // front face plane z
        double y0 = COURT.boardBottom, y1 = COURT.boardBottom + COURT.boardH, hw = COURT.boardW / 2;
        if (y < y0 - r || y > y1 + r || Math.Abs(x) > hw + r) return;
        double depth = (z - face) * side; // >0 means past the face (into the board)
        if (depth > -r && depth < COURT.boardT + r)
        {
            // closest point on board box to center
            double cx = Math.Max(-hw, Math.Min(hw, x)), cy = Math.Max(y0, Math.Min(y1, y));
            double czMin = Math.Min(face, face + side * COURT.boardT), czMax = Math.Max(face, face + side * COURT.boardT);
            double cz = Math.Max(czMin, Math.Min(czMax, z));
            double px = x - cx, py = y - cy, pz = z - cz;
            double dist = JsMath.Hypot(px, py, pz);
            if (dist < r)
            {
                double nx, ny, nz;
                if (dist > 1e-6) { nx = px / dist; ny = py / dist; nz = pz / dist; } else { nx = 0; ny = 0; nz = -side; }
                double pen = r - dist;
                x += nx * pen; y += ny * pen; z += nz * pen;
                double vn = vx * nx + vy * ny + vz * nz;
                if (vn < 0)
                {
                    double e = 0.62;
                    vx -= (1 + e) * vn * nx; vy -= (1 + e) * vn * ny; vz -= (1 + e) * vn * nz;
                    vx *= 0.94; vy *= 0.94;
                    touchedBoard = true;
                    if (-vn > 0.3) events?.Add(new BallEvent { Type = "board", Side = side, V = -vn });
                }
            }
        }
    }

    /// <summary>Clone ball for trajectory pre-simulation (cloneBall: Object.assign copy, info dropped).</summary>
    public Ball Clone()
    {
        var c = (Ball)MemberwiseClone();
        c.info = null;
        return c;
    }

    /// <summary>Simulate a shot forward to find whether it scores. Returns (made, rim, board, time).</summary>
    public static PredictResult predictShot(Ball ball, double maxT = 4)
    {
        var b = ball.Clone();
        var ev = new List<BallEvent>();
        double dt = 1.0 / 60;
        bool made = false; double t = 0;
        while (t < maxT)
        {
            ev.Clear();
            b.step(dt, ev);
            t += dt;
            foreach (var e in ev) if (e.Type == "through") made = true;
            if (made) break;
            if (b.y < 1.5 && b.vy < 0 && b.floorBounces > 0) break;
            if (b.y <= Constants.BALL_R + 0.001 && t > 0.4) break;
        }
        return new PredictResult(made, b.touchedRim, b.touchedBoard, t);
    }
}

public readonly record struct PredictResult(bool made, bool rim, bool board, double time);
