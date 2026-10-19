// Port of client/js/sim/constants.js. Regulation-style court geometry in meters. Court long axis = Z, rims at ±hoopZ, y up.
namespace Rimrift.Sim;

public static class COURT
{
    public const double length = 28.65, width = 15.24,
        hoopZ = 12.725, rimY = 3.05, rimR = 0.2286, rimTube = 0.0095,
        boardZ = 13.105, boardW = 1.83, boardH = 1.07, boardBottom = 2.9, boardT = 0.05,
        keyWidth = 4.88, ftDist = 5.79, ftRadius = 1.83,
        threeRadius = 7.24, cornerThree = 6.71, restricted = 1.22, centerRadius = 1.83;
}

public readonly record struct Vec3(double x, double y, double z);

public static class Constants
{
    public const double BALL_R = 0.1194;
    public const double GRAVITY = 9.81;
    public const double SIM_HZ = 60;
    public const double DT = 1 / SIM_HZ;

    /// <summary>Rim center for a side (+1 / -1)</summary>
    public static Vec3 rimPos(double side) => new(0, COURT.rimY, side * COURT.hoopZ);

    /// <summary>Is (x,z) beyond the three-point line for the rim on `side`?</summary>
    public static bool isThree(double x, double z, double side)
    {
        double rz = side * COURT.hoopZ;
        double dz = (z - rz) * side; // positive = toward baseline
        double d = JsMath.Hypot(x, z - rz);
        bool cornerZone = dz > -Math.Sqrt(JsMath.Pow(COURT.threeRadius, 2) - JsMath.Pow(COURT.cornerThree, 2));
        if (cornerZone && Math.Abs(x) >= COURT.cornerThree) return true;
        if (cornerZone) return false;
        return d >= COURT.threeRadius;
    }

    // v0.4.7.5 qp3: the lane (the paint / the key) in front of the rim on `side`
    public static class LANE
    {
        public const double halfW = COURT.keyWidth / 2, zNear = COURT.length / 2 - COURT.ftDist, zFar = COURT.length / 2;
    }
    public static bool inLane(double x, double z, double side, double m = 0)
    {
        double zz = z * side;
        return Math.Abs(x) <= LANE.halfW + m && zz >= LANE.zNear - m && zz <= LANE.zFar + m;
    }
    public static bool inBounds(double x, double z, double pad = 0)
    {
        return Math.Abs(x) <= COURT.width / 2 + pad && Math.Abs(z) <= COURT.length / 2 + pad;
    }
    public const double INCH = 0.0254;
    public const double LB = 0.4536;

    // v0.4.5 out of bounds, regulation style (see constants.js for the rationale)
    public const double LINE_W = 0.0508;
    public const double FOOT_R = 0.12;
    public static bool ballOut(double x, double z, bool half = false)
    {
        return Math.Abs(x) >= COURT.width / 2 || Math.Abs(z) >= COURT.length / 2 || (half && z <= 0);
    }
    public static bool feetOut(double x, double z, bool half = false)
    {
        return Math.Abs(x) + FOOT_R >= COURT.width / 2 || Math.Abs(z) + FOOT_R >= COURT.length / 2 || (half && z - FOOT_R <= 0);
    }
}
