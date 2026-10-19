// RIMRIFT parity harness — C# side.
//   dotnet run -c Release                 replay harness/out/traces.jsonl tick by tick, bit for bit → PASS/FAIL
//   dotnet run -c Release -- --planner    re-run planShot from the recorded RNG state, compare plan + RNG draws
//   dotnet run -c Release -- --math       compare JsMath / System.Math against Node's Math.* samples (harness/out/math.jsonl)
//   dotnet run -c Release -- --tunnel     tunnelling measurement at 15 / 20 / 25 m/s (SUB=4, then 8 and 16 for information)
//   dotnet run -c Release -- --all        everything
using Rimrift.Harness;

static string FindOut()
{
    var dir = AppContext.BaseDirectory;
    for (int i = 0; i < 8 && dir != null; i++)
    {
        var cand = Path.Combine(dir, "harness", "out");
        if (Directory.Exists(cand)) return cand;
        cand = Path.Combine(dir, "out");
        if (Directory.Exists(cand) && File.Exists(Path.Combine(dir, "export_traces.mjs"))) return cand;
        dir = Path.GetDirectoryName(dir);
    }
    return Path.Combine(Directory.GetCurrentDirectory(), "out");
}

var outDir = args.FirstOrDefault(a => a.StartsWith("--out="))?.Substring(6) ?? FindOut();
bool all = args.Contains("--all");
bool any = false, fail = false;
var sw = System.Diagnostics.Stopwatch.StartNew();

if (all || args.Contains("--math"))
{
    any = true;
    var path = Path.Combine(outDir, "math.jsonl");
    Console.WriteLine($"== --math: {path}");
    if (!File.Exists(path)) { Console.WriteLine("  missing: run `node harness/export_traces.mjs --math`"); fail = true; }
    else
    {
        var rows = MathCheck.Run(path, Console.Out);
        int miss = rows.Sum(r => r.JsMathMiss);
        Console.WriteLine($"  JsMath vs Node: {rows.Sum(r => r.N)} samples, {miss} mismatches → {(miss == 0 ? "PASS" : "FAIL")}");
        if (miss != 0) fail = true;
    }
}

if (all || args.Contains("--planner"))
{
    any = true;
    var path = Path.Combine(outDir, "traces.jsonl");
    Console.WriteLine($"== --planner: {path}");
    var (shots, diverged, first) = Replay.Planner(path, Console.Out);
    Console.WriteLine($"  planShot: {shots} shots compared (launch velocity + spin, made/bank/rim/ghost, RNG state after), {diverged} diverged → {(diverged == 0 ? "PASS" : "FAIL")}");
    if (first != null) Console.WriteLine("  first divergence: " + first);
    if (diverged != 0) fail = true;
}

if (all || args.Contains("--tunnel"))
{
    any = true;
    Console.WriteLine("== --tunnel (JS semantics: SUB=4; higher SUB for information only)");
    bool gate = true;
    foreach (var sub in new[] { 4, 8, 16 })
        foreach (var speed in new[] { 15.0, 20.0, 25.0 })
        {
            var r = Tunnel.Run(speed, sub);
            Console.WriteLine("  " + r + $"  deepest skim={r.DeepestSkim * 1000:0.00} mm" + (double.IsFinite(r.ClosestMiss) ? $"  closest clean miss={r.ClosestMiss * 1000:0.0} mm" : ""));
            if (sub == 4 && speed == 20 && (r.Through > 0 || r.Inside > 0)) gate = false;
        }
    Console.WriteLine($"  gate 'no tunnelling (through-tube / ended-inside) at 20 m/s, SUB=4': {(gate ? "PASS" : "FAIL")}");
    if (!gate) fail = true;
}

if (!any || all || args.Contains("--traces"))
{
    var path = Path.Combine(outDir, "traces.jsonl");
    Console.WriteLine($"== traces: {path}");
    if (!File.Exists(path)) { Console.WriteLine("  missing: run `node harness/export_traces.mjs`"); fail = true; }
    else
    {
        var (shots, ticks, events, diverged, first) = Replay.Traces(path, Console.Out);
        Console.WriteLine($"  shots compared: {shots}");
        Console.WriteLine($"  ticks compared: {ticks} (9 doubles + 5 flags each, bit for bit)");
        Console.WriteLine($"  events compared: {events}");
        Console.WriteLine($"  shots diverged: {diverged}");
        if (first != null) Console.WriteLine("  first divergence: " + first);
        Console.WriteLine($"  ball parity: {(diverged == 0 && shots > 0 ? "PASS" : "FAIL")}");
        if (diverged != 0 || shots == 0) fail = true;
    }
}

Console.WriteLine($"== {(fail ? "FAIL" : "PASS")} ({sw.Elapsed.TotalSeconds:0.0} s)");
return fail ? 1 : 0;
