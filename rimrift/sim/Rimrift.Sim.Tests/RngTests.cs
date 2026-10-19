using Rimrift.Sim;
using Xunit;

namespace Rimrift.Sim.Tests;

public class RngTests
{
    static ulong Bits(double d) => unchecked((ulong)BitConverter.DoubleToInt64Bits(d));

    [Fact]
    public void Mulberry32_sequence_matches_Node()
    {
        var r = new Rng(11);
        ulong[] expected = { 0x3fe05eebcd600000, 0x3fe0f5522b800000, 0x3fe375b510200000, 0x3fe2e29244400000, 0x3feb39900cc00000 };
        foreach (var e in expected) Assert.Equal(e, Bits(r.Next()));
        Assert.Equal(0x3fd6f80dae000000UL, Bits(new Rng(0).Next())); // seed 0 → 0x9e3779b9
    }

    [Fact]
    public void Derived_draws_match_Node()
    {
        var r = new Rng(5);
        Assert.Equal(0x3fbf6bd89799d00dUL, Bits(r.Normal())); // Box–Muller through JsMath.Log / JsMath.Cos
        Assert.Equal(2, r.Int(1, 6));
        Assert.Equal(0x3fcf88a5b5000000UL, Bits(r.Range(-1, 1)));
    }

    [Fact]
    public void HashString_is_FNV1a_over_UTF16()
    {
        Assert.Equal(1448752751u, Rng.HashString("afterhours16"));
        Assert.Equal(2166136261u, Rng.HashString(""));
    }

    [Fact]
    public void Shuffle_and_pick_are_deterministic()
    {
        var a = new Rng(3).Shuffle(new List<int> { 1, 2, 3, 4, 5, 6 });
        var b = new Rng(3).Shuffle(new List<int> { 1, 2, 3, 4, 5, 6 });
        Assert.Equal(a, b);
        Assert.Equal(new Rng(9).Pick(new[] { "a", "b", "c" }), new Rng(9).Pick(new[] { "a", "b", "c" }));
    }
}
