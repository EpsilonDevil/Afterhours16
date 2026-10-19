// Port of client/js/core/rng.js: seeded deterministic RNG (mulberry32) used by the simulation and procedural content.
// The JS keeps `s` as a Number and lets it grow past 2^32 (only the ToInt32 of it feeds the hash), so `s` is a double
// here too: that is bit-faithful even after millions of draws, where the JS addition itself starts to round.
namespace Rimrift.Sim;

public sealed class Rng
{
    double s;

    public Rng(double seed = 1)
    {
        uint u = unchecked((uint)JsMath.ToInt32(seed)); // seed >>> 0
        s = u != 0 ? u : 0x9e3779b9u;
    }

    /// <summary>The raw state (a JS Number), for save/restore and tests.</summary>
    public double State { get => s; set => s = value; }

    public double Next()
    {
        s += 0x6d2b79f5;                                         // let t = (this.s += 0x6d2b79f5)
        int t = JsMath.ToInt32(s);
        t = JsMath.Imul(t ^ (int)((uint)t >> 15), t | 1);        // t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= unchecked(t + JsMath.Imul(t ^ (int)((uint)t >> 7), t | 61)); // t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return (double)(uint)(t ^ (int)((uint)t >> 14)) / 4294967296.0;  // ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    public double Range(double a, double b) => a + (b - a) * Next();
    public double Int(double a, double b) => Math.Floor(Range(a, b + 1));
    public T Pick<T>(IReadOnlyList<T> arr) => arr[(int)Math.Floor(Next() * arr.Count)];
    public bool Chance(double p) => Next() < p;

    public double Normal() // Box–Muller
    {
        double u = 0, v = 0;
        while (u == 0) u = Next();
        while (v == 0) v = Next();
        return Math.Sqrt(-2 * JsMath.Log(u)) * JsMath.Cos(2 * JsMath.PI * v);
    }

    public IList<T> Shuffle<T>(IList<T> arr)
    {
        for (int i = arr.Count - 1; i > 0; i--)
        {
            int j = (int)Math.Floor(Next() * (i + 1));
            (arr[i], arr[j]) = (arr[j], arr[i]);
        }
        return arr;
    }

    /// <summary>FNV-1a over the UTF-16 code units (charCodeAt), as rng.js hashString.</summary>
    public static uint HashString(string str)
    {
        int h = unchecked((int)2166136261u);
        for (int i = 0; i < str.Length; i++) { h ^= str[i]; h = JsMath.Imul(h, 16777619); }
        return unchecked((uint)h);
    }
}
