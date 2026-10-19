// Bit-exact spot checks against values captured from Node 22 (V8 12.4). The full 1.6M-sample comparison is the
// harness's --math mode; these pin the ports so a refactor cannot silently drift.
using Rimrift.Sim;
using Xunit;

namespace Rimrift.Sim.Tests;

public class JsMathTests
{
    static double D(ulong bits) => BitConverter.Int64BitsToDouble(unchecked((long)bits));
    static void Bits(ulong expected, double actual) => Assert.Equal(expected, unchecked((ulong)BitConverter.DoubleToInt64Bits(actual)));

    [Fact]
    public void Hypot_matches_V8_kahan_normalised_sum()
    {
        Bits(0x4014000000000000, JsMath.Hypot(3, 4));
        Bits(0x3fd7f254dab9cc3b, JsMath.Hypot(0.1, 0.2, 0.3));
        Bits(0x401eacfc382444f6, JsMath.Hypot(1e-3, 2.5, -7.25));
        Assert.Equal(0, JsMath.Hypot(0, 0, 0));
        Assert.Equal(double.PositiveInfinity, JsMath.Hypot(double.NaN, double.PositiveInfinity));
        Assert.True(double.IsNaN(JsMath.Hypot(double.NaN, 1)));
    }

    [Fact]
    public void Trig_matches_fdlibm()
    {
        Bits(0xbfd38f2fa75d9289, JsMath.Sin(1e4));
        Bits(0xbfefb2767a795fa9, JsMath.Sin(4321.123));
        Bits(0x3fe87996529f9d93, JsMath.Cos(0.7));
        Bits(0x400493c43acb164d, JsMath.Tan(1.2));
        Bits(0xbfeb453ab76bf397, JsMath.Sin(1e22)); // the __kernel_rem_pio2 path
    }

    [Fact]
    public void Exp_log_pow_match_fdlibm()
    {
        Bits(0x3feffae1b08408b9, JsMath.Exp(-0.15 / 240));
        Bits(0x3fef4666c4bb6166, JsMath.Exp(-5.5 / 240));
        Bits(0x4015e552770df8a6, JsMath.Exp(1.7));
        Bits(0xbfefd0ea24bf89b8, JsMath.Log(0.37));
        Bits(0x3fd1be981346349e, JsMath.Pow(0.4, 1.4));
        Bits(0x3ff54bc6a7ef9db4, JsMath.Pow(1.1, 3));
        Bits(0x3ff06576c7121526, JsMath.Pow(95.0 / 85.0, 0.22));
        Assert.Equal(1.0, JsMath.Pow(double.NaN, 0));
        Assert.True(double.IsNaN(JsMath.Pow(-8, 0.5)));
        Assert.Equal(Math.Sqrt(2), JsMath.Pow(2, 0.5));
    }

    [Fact]
    public void Round_is_ECMAScript_round_half_up()
    {
        Assert.Equal(3, JsMath.Round(2.5));
        Assert.Equal(-2, JsMath.Round(-2.5));
        Assert.Equal(0, JsMath.Round(0.49999999999999994)); // floor(x + 0.5) would give 1
        Assert.True(double.IsNegative(JsMath.Round(-0.5)));  // -0
        Assert.Equal(-1, JsMath.Round(-0.51));
    }

    [Fact]
    public void Int32_ops_wrap_like_JS()
    {
        Assert.Equal(-2, JsMath.Imul(0x7fffffff, 2)); // Math.imul(0x7fffffff, 2) === -2
        Assert.Equal(-1, JsMath.ToInt32(4294967295.0));
        Assert.Equal(0, JsMath.ToInt32(double.NaN));
        Assert.Equal(1, JsMath.ToInt32(4294967297.0));
        Assert.Equal(-2, JsMath.ToInt32(-2.9));
    }
}
