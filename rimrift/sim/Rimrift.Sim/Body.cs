// ratings.physical() reads bodyDims(build).reachStanding from client/js/char/skeleton.js; this is that one function
// (bodyDims + standingReach), ported exactly so the standing reach the contest model measures against is the JS one.
// The full skeleton port lives in Rimrift.Anim (Character agent); Rimrift.Sim must not depend on it.
namespace Rimrift.Sim;

public sealed class BodyDims
{
    public double H, W, WS, girth, muscle, armScale, hipY, spineLen, chestLen, neckLen, headLen, clavX, clavY, shoulderX,
        upperLen, foreLen, handLen, hipX, hipDrop, thighLen, shinLen, ankleY, footLen, toeFwd, headR, reachStanding;
}

public static class Body
{
    public const double OVERHEAD_LIFT = 0.025;

    public static double standingReach(BodyDims d)
    {
        return d.hipY + d.spineLen + d.chestLen + d.clavY + 0.002 * d.H + OVERHEAD_LIFT * d.H + d.upperLen + d.foreLen + d.handLen;
    }

    /// <summary>Build → body dimensions in meters. build: {height (in), weight (lb), wingspan (in)}</summary>
    public static BodyDims bodyDims(Build build)
    {
        double H = Ratings.Or(build.height, 78) * Constants.INCH;
        double W = Ratings.Or(build.weight, 210) * 0.4536;
        double WS = Ratings.Or(build.wingspan, Ratings.Undef(build.height) + 3) * Constants.INCH;
        double bmi = W / (H * H);
        double girth = Math.Max(0.86, Math.Min(1.28, Math.Sqrt(bmi / 23.5)));
        double muscle = Math.Max(0.9, Math.Min(1.2, 1 + (bmi - 24) * 0.03));
        double shoulderX = 0.094 * H * Math.Min(1.1, girth * 0.5 + 0.52);
        double armScale = Math.Max(0.8, (WS / 2 - shoulderX) / (0.424 * H));
        var d = new BodyDims
        {
            H = H, W = W, WS = WS, girth = girth, muscle = muscle, armScale = armScale,
            hipY = 0.535 * H,
            spineLen = 0.075 * H, chestLen = 0.10 * H, neckLen = 0.115 * H, headLen = 0.05 * H,
            clavX = 0.022 * H, clavY = 0.097 * H, shoulderX = shoulderX,
            upperLen = 0.172 * H * armScale, foreLen = 0.148 * H * armScale, handLen = 0.104 * H * armScale,
            hipX = 0.05 * H * Math.Min(1.1, girth), hipDrop = 0.03 * H,
            thighLen = 0.235 * H, shinLen = 0.23 * H, ankleY = 0.04 * H,
            footLen = 0.152 * H, toeFwd = 0.105 * H,
            headR = 0.063 * H,
        };
        d.reachStanding = standingReach(d);
        return d;
    }
}
