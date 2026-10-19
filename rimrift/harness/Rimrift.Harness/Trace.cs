// The JSONL records export_traces.mjs writes, and the hex ↔ double helpers (every number is a 64-bit pattern).
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Rimrift.Harness;

public static class Hex
{
    public static double ToDouble(string h) => BitConverter.Int64BitsToDouble(unchecked((long)ulong.Parse(h, NumberStyles.HexNumber, CultureInfo.InvariantCulture)));
    public static string Of(double d) => BitConverter.DoubleToInt64Bits(d).ToString("x16");
    /// <summary>Bit-identical (a NaN of any payload equals a NaN: JS cannot observe the payload).</summary>
    public static bool Same(double a, double b) => BitConverter.DoubleToInt64Bits(a) == BitConverter.DoubleToInt64Bits(b) || (double.IsNaN(a) && double.IsNaN(b));
    public static string Show(double d) => $"{Of(d)} ({d.ToString("R", CultureInfo.InvariantCulture)})";
}

public sealed class TraceEvent
{
    [JsonPropertyName("t")] public string T { get; set; } = "";
    [JsonPropertyName("side")] public int? Side { get; set; }
    [JsonPropertyName("clean")] public bool? Clean { get; set; }
    [JsonPropertyName("rim")] public bool? Rim { get; set; }
    [JsonPropertyName("v")] public string? V { get; set; }
    [JsonPropertyName("x")] public string? X { get; set; }
    [JsonPropertyName("y")] public string? Y { get; set; }
    [JsonPropertyName("z")] public string? Z { get; set; }
}
public sealed class TraceTick
{
    [JsonPropertyName("s")] public string[] S { get; set; } = Array.Empty<string>();
    [JsonPropertyName("e")] public TraceEvent[] E { get; set; } = Array.Empty<TraceEvent>();
    [JsonPropertyName("f")] public double[] F { get; set; } = Array.Empty<double>(); // touchedRim, touchedBoard, scoredFlag, floorBounces, netTouched
}
public sealed class TraceOpts
{
    [JsonPropertyName("halfOnly")] public bool HalfOnly { get; set; }
    [JsonPropertyName("surface")] public string Surface { get; set; } = "wood";
    [JsonPropertyName("swish")] public bool Swish { get; set; }
    [JsonPropertyName("guarantee")] public bool Guarantee { get; set; }
    [JsonPropertyName("bad")] public bool Bad { get; set; }
    [JsonPropertyName("bank")] public bool Bank { get; set; }
}
public sealed class TracePlan
{
    [JsonPropertyName("v")] public string[] V { get; set; } = Array.Empty<string>();
    [JsonPropertyName("made")] public bool Made { get; set; }
    [JsonPropertyName("bank")] public bool? Bank { get; set; }
    [JsonPropertyName("rim")] public bool? Rim { get; set; }
    [JsonPropertyName("ghost")] public bool Ghost { get; set; }
}
public sealed class TraceEnd
{
    [JsonPropertyName("touchedRim")] public bool TouchedRim { get; set; }
    [JsonPropertyName("touchedBoard")] public bool TouchedBoard { get; set; }
    [JsonPropertyName("scoredFlag")] public int ScoredFlag { get; set; }
    [JsonPropertyName("floorBounces")] public int FloorBounces { get; set; }
    [JsonPropertyName("ticks")] public int Ticks { get; set; }
}
public sealed class TraceShot
{
    [JsonPropertyName("seed")] public int Seed { get; set; }
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("side")] public int Side { get; set; }
    [JsonPropertyName("halfOnly")] public bool HalfOnly { get; set; }
    [JsonPropertyName("surface")] public string Surface { get; set; } = "wood";
    [JsonPropertyName("arc")] public double Arc { get; set; }
    [JsonPropertyName("make")] public bool Make { get; set; }
    [JsonPropertyName("P")] public string[] P { get; set; } = Array.Empty<string>();
    [JsonPropertyName("rim")] public string[] Rim { get; set; } = Array.Empty<string>();
    [JsonPropertyName("opts")] public TraceOpts Opts { get; set; } = new();
    [JsonPropertyName("rngBefore")] public string RngBefore { get; set; } = "";
    [JsonPropertyName("rngAfter")] public string RngAfter { get; set; } = "";
    [JsonPropertyName("plan")] public TracePlan Plan { get; set; } = new();
    [JsonPropertyName("launch")] public string[] Launch { get; set; } = Array.Empty<string>();
    [JsonPropertyName("ticks")] public TraceTick[] Ticks { get; set; } = Array.Empty<TraceTick>();
    [JsonPropertyName("end")] public TraceEnd End { get; set; } = new();

    public static IEnumerable<TraceShot> ReadAll(string path)
    {
        foreach (var line in File.ReadLines(path))
        {
            if (line.Length == 0) continue;
            yield return JsonSerializer.Deserialize<TraceShot>(line)!;
        }
    }
}

public sealed class MathSample
{
    [JsonPropertyName("fn")] public string Fn { get; set; } = "";
    [JsonPropertyName("a")] public string[] A { get; set; } = Array.Empty<string>();
    [JsonPropertyName("r")] public string R { get; set; } = "";
}
