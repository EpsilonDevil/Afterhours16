// --math: every Math.* sample Node wrote must come out of JsMath (and, for information, System.Math) bit-identical.
using System.Text.Json;
using Rimrift.Sim;

namespace Rimrift.Harness;

public static class MathCheck
{
    public sealed class Row { public string Fn = ""; public int N, JsMathMiss, SysMathMiss; public string? FirstMiss; }

    public static List<Row> Run(string path, TextWriter log)
    {
        var rows = new Dictionary<string, Row>();
        foreach (var line in File.ReadLines(path))
        {
            if (line.Length == 0) continue;
            var m = JsonSerializer.Deserialize<MathSample>(line)!;
            var a = m.A.Select(Hex.ToDouble).ToArray();
            double js = Hex.ToDouble(m.R);
            double cs, sys;
            switch (m.Fn)
            {
                case "sin": cs = JsMath.Sin(a[0]); sys = Math.Sin(a[0]); break;
                case "cos": cs = JsMath.Cos(a[0]); sys = Math.Cos(a[0]); break;
                case "tan": cs = JsMath.Tan(a[0]); sys = Math.Tan(a[0]); break;
                case "exp": cs = JsMath.Exp(a[0]); sys = Math.Exp(a[0]); break;
                case "log": cs = JsMath.Log(a[0]); sys = Math.Log(a[0]); break;
                case "pow": cs = JsMath.Pow(a[0], a[1]); sys = Math.Pow(a[0], a[1]); break;
                case "hypot2": cs = JsMath.Hypot(a[0], a[1]); sys = Math.Sqrt(a[0] * a[0] + a[1] * a[1]); break;
                case "hypot3": cs = JsMath.Hypot(a[0], a[1], a[2]); sys = Math.Sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); break;
                default: continue;
            }
            if (!rows.TryGetValue(m.Fn, out var r)) rows[m.Fn] = r = new Row { Fn = m.Fn };
            r.N++;
            if (!Hex.Same(js, cs)) { r.JsMathMiss++; r.FirstMiss ??= $"{m.Fn}({string.Join(", ", a.Select(Hex.Show))}) JS={Hex.Show(js)} JsMath={Hex.Show(cs)}"; }
            if (!Hex.Same(js, sys)) r.SysMathMiss++;
        }
        log.WriteLine($"{"fn",-8}{"samples",10}{"JsMath mismatches",20}{"System.Math mismatches",24}");
        foreach (var r in rows.Values.OrderBy(r => r.Fn))
        {
            log.WriteLine($"{r.Fn,-8}{r.N,10}{r.JsMathMiss,20}{r.SysMathMiss,24}");
            if (r.FirstMiss != null) log.WriteLine("    first JsMath miss: " + r.FirstMiss);
        }
        return rows.Values.ToList();
    }
}
