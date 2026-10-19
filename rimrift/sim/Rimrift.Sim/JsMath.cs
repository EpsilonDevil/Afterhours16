// Bit-exact ports of the V8 (Node 22 / V8 12.4) implementations of the Math functions the JS sim uses, so the C#
// sim reproduces the browser engine's doubles bit for bit on every platform (.NET's System.Math transcendental
// functions call the platform CRT — glibc on Linux, UCRT on Windows — which differ from each other and from V8).
//
//   Hypot            src/builtins/math.tq MathHypot (max-normalised Kahan sum, NOT sqrt(x*x+y*y))
//   Sin/Cos/Tan      src/base/ieee754.cc fdlibm ports (s_sin.c, s_cos.c, s_tan.c, k_sin.c, k_cos.c, k_tan.c,
//                    e_rem_pio2.c, k_rem_pio2.c). Node's gyp build does not define V8_USE_LIBM_TRIG_FUNCTIONS, so
//                    these (not the vendored glibc ones) are what Node 22 runs.
//   Exp/Log/Pow      src/base/ieee754.cc (e_exp.c, e_log.c, e_pow.c). `x ** y` and Math.pow both go through pow.
//   Round            ECMAScript Math.round (round half up, -0 preserved), the way TurboFan lowers it.
//   Floor/Sqrt/Abs/Max/Min are IEEE-identical in .NET and are used from System.Math directly.
//
// Transcribed statement for statement from V8 12.4.254 src/base/ieee754.cc; the C int/uint word games are kept.
namespace Rimrift.Sim;

public static class JsMath
{
    public const double PI = 3.141592653589793;
    /// <summary>std::numeric_limits&lt;double&gt;::signaling_NaN(), the bit pattern V8's pow/log hand back (0x7ff4000000000000).</summary>
    public static readonly double SignalingNaN = BitConverter.Int64BitsToDouble(0x7ff4000000000000);

    // ---- word access (the fdlibm GET/SET_*_WORD macros) ----
    static long Bits(double d) => BitConverter.DoubleToInt64Bits(d);
    static int Hi(double d) => (int)(Bits(d) >> 32);
    static uint Lo(double d) => (uint)Bits(d);
    static double FromWords(int hi, uint lo) => BitConverter.Int64BitsToDouble(((long)hi << 32) | lo);
    static double SetHi(double d, int hi) => FromWords(hi, Lo(d));
    static double SetLo(double d, uint lo) => FromWords(Hi(d), lo);

    // ---------------------------------------------------------------- Math.hypot
    public static double Hypot(double a, double b) => Hypot(stackalloc double[] { a, b });
    public static double Hypot(double a, double b, double c) => Hypot(stackalloc double[] { a, b, c });
    public static double Hypot(double a, double b, double c, double d) => Hypot(stackalloc double[] { a, b, c, d });

    public static double Hypot(ReadOnlySpan<double> args)
    {
        int length = args.Length;
        if (length == 0) return 0;
        Span<double> absValues = stackalloc double[length];
        bool oneArgIsNaN = false;
        double max = 0;
        for (int i = 0; i < length; i++)
        {
            double value = args[i];
            if (double.IsNaN(value)) { oneArgIsNaN = true; absValues[i] = 0; }
            else
            {
                double absValue = Math.Abs(value);
                absValues[i] = absValue;
                if (absValue > max) max = absValue;
            }
        }
        if (max == double.PositiveInfinity) return double.PositiveInfinity;
        if (oneArgIsNaN) return double.NaN;
        if (max == 0) return 0;
        double sum = 0, compensation = 0;
        for (int i = 0; i < length; i++)
        {
            double n = absValues[i] / max;
            double summand = n * n - compensation;
            double preliminary = sum + summand;
            compensation = (preliminary - sum) - summand;
            sum = preliminary;
        }
        return Math.Sqrt(sum) * max;
    }

    // ---------------------------------------------------------------- Math.round
    /// <summary>ECMAScript Math.round as V8 lowers it (Float64Round): ceil(x), minus one when ceil(x) - 0.5 &gt; x.
    /// Round(0.49999999999999994) is 0 (floor(x + 0.5) would say 1); -0.5 rounds to -0.</summary>
    public static double Round(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x)) return x;
        double r = Math.Ceiling(x);
        if (r - 0.5 > x) r -= 1;
        if (r == 0 && (x < 0 || (x == 0 && double.IsNegative(x)))) return -0.0;
        return r;
    }

    // ---------------------------------------------------------------- JS integer ops
    /// <summary>Math.imul: 32-bit wrapping multiply.</summary>
    public static int Imul(int a, int b) => unchecked(a * b);
    /// <summary>ToInt32 of a double (the `| 0` conversion): modulo 2^32, NaN/Inf → 0.</summary>
    public static int ToInt32(double d)
    {
        if (double.IsNaN(d) || double.IsInfinity(d)) return 0;
        double t = Math.Truncate(d);
        double m = t % 4294967296.0; // fmod keeps the sign
        if (m < 0) m += 4294967296.0;
        return unchecked((int)(uint)m);
    }

    // ---------------------------------------------------------------- __ieee754_rem_pio2
    static readonly int[] TwoOverPi = {
        0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C,
        0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649,
        0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44,
        0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B,
        0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D,
        0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
        0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330,
        0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
        0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
        0x73A8C9, 0x60E27B, 0xC08C6B,
    };
    static readonly int[] Npio2Hw = {
        0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
        0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
        0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
        0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
        0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
        0x404858EB, 0x404921FB,
    };

    static int RemPio2(double x, Span<double> y)
    {
        const double zero = 0.0, half = 0.5, two24 = 1.67772160000000000000e+07,
            invpio2 = 6.36619772367581382433e-01,
            pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
            pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21,
            pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32;
        double z, w, t, r, fn;
        Span<double> tx = stackalloc double[3];
        int e0, i, j, nx, n, ix, hx;
        z = 0;
        hx = Hi(x);
        ix = hx & 0x7FFFFFFF;
        if (ix <= 0x3FE921FB) { y[0] = x; y[1] = 0; return 0; }
        if (ix < 0x4002D97C)
        {
            if (hx > 0)
            {
                z = x - pio2_1;
                if (ix != 0x3FF921FB) { y[0] = z - pio2_1t; y[1] = (z - y[0]) - pio2_1t; }
                else { z -= pio2_2; y[0] = z - pio2_2t; y[1] = (z - y[0]) - pio2_2t; }
                return 1;
            }
            else
            {
                z = x + pio2_1;
                if (ix != 0x3FF921FB) { y[0] = z + pio2_1t; y[1] = (z - y[0]) + pio2_1t; }
                else { z += pio2_2; y[0] = z + pio2_2t; y[1] = (z - y[0]) + pio2_2t; }
                return -1;
            }
        }
        if (ix <= 0x413921FB)
        {
            t = Math.Abs(x);
            n = (int)(t * invpio2 + half);
            fn = n;
            r = t - fn * pio2_1;
            w = fn * pio2_1t;
            if (n < 32 && ix != Npio2Hw[n - 1])
            {
                y[0] = r - w;
            }
            else
            {
                uint high;
                j = ix >> 20;
                y[0] = r - w;
                high = (uint)Hi(y[0]);
                i = j - (int)((high >> 20) & 0x7FF);
                if (i > 16)
                {
                    t = r;
                    w = fn * pio2_2;
                    r = t - w;
                    w = fn * pio2_2t - ((t - r) - w);
                    y[0] = r - w;
                    high = (uint)Hi(y[0]);
                    i = j - (int)((high >> 20) & 0x7FF);
                    if (i > 49)
                    {
                        t = r;
                        w = fn * pio2_3;
                        r = t - w;
                        w = fn * pio2_3t - ((t - r) - w);
                        y[0] = r - w;
                    }
                }
            }
            y[1] = (r - y[0]) - w;
            if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
            return n;
        }
        if (ix >= 0x7FF00000) { y[0] = y[1] = x - x; return 0; }
        uint low = Lo(x);
        z = SetLo(z, low);
        e0 = (ix >> 20) - 1046;
        z = SetHi(z, unchecked(ix - (int)((uint)e0 << 20)));
        for (i = 0; i < 2; i++)
        {
            tx[i] = (int)z;
            z = (z - tx[i]) * two24;
        }
        tx[2] = z;
        nx = 3;
        while (tx[nx - 1] == zero) nx--;
        n = KernelRemPio2(tx, y, e0, nx, 2, TwoOverPi);
        if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
        return n;
    }

    // ---------------------------------------------------------------- __kernel_rem_pio2
    static readonly int[] InitJk = { 2, 3, 4, 6 };
    static readonly double[] PIo2 = {
        1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15,
        3.28200341580791294123e-22, 1.27065575308067607349e-29, 1.22933308981111328932e-36,
        2.73370053816464559624e-44, 2.16741683877804819444e-51,
    };

    static int KernelRemPio2(Span<double> x, Span<double> y, int e0, int nx, int prec, int[] ipio2)
    {
        const double zero = 0.0, one = 1.0, two24 = 1.67772160000000000000e+07, twon24 = 5.96046447753906250000e-08;
        int jz, jx, jv, jp, jk, carry, n, i, j, k, m, q0, ih;
        Span<int> iq = stackalloc int[20];
        double z, fw;
        Span<double> f = stackalloc double[20];
        Span<double> fq = stackalloc double[20];
        Span<double> q = stackalloc double[20];

        jk = InitJk[prec];
        jp = jk;
        jx = nx - 1;
        jv = (e0 - 3) / 24;
        if (jv < 0) jv = 0;
        q0 = e0 - 24 * (jv + 1);
        j = jv - jx;
        m = jx + jk;
        for (i = 0; i <= m; i++, j++) f[i] = (j < 0) ? zero : (double)ipio2[j];
        for (i = 0; i <= jk; i++)
        {
            for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
            q[i] = fw;
        }
        jz = jk;
    recompute:
        for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--)
        {
            fw = (double)(int)(twon24 * z);
            iq[i] = (int)(z - two24 * fw);
            z = q[j - 1] + fw;
        }
        z = Math.ScaleB(z, q0);
        z -= 8.0 * Math.Floor(z * 0.125);
        n = (int)z;
        z -= (double)n;
        ih = 0;
        if (q0 > 0)
        {
            i = (iq[jz - 1] >> (24 - q0));
            n += i;
            iq[jz - 1] -= i << (24 - q0);
            ih = iq[jz - 1] >> (23 - q0);
        }
        else if (q0 == 0) ih = iq[jz - 1] >> 23;
        else if (z >= 0.5) ih = 2;

        if (ih > 0)
        {
            n += 1;
            carry = 0;
            for (i = 0; i < jz; i++)
            {
                j = iq[i];
                if (carry == 0)
                {
                    if (j != 0) { carry = 1; iq[i] = 0x1000000 - j; }
                }
                else iq[i] = 0xFFFFFF - j;
            }
            if (q0 > 0)
            {
                switch (q0)
                {
                    case 1: iq[jz - 1] &= 0x7FFFFF; break;
                    case 2: iq[jz - 1] &= 0x3FFFFF; break;
                }
            }
            if (ih == 2)
            {
                z = one - z;
                if (carry != 0) z -= Math.ScaleB(one, q0);
            }
        }
        if (z == zero)
        {
            j = 0;
            for (i = jz - 1; i >= jk; i--) j |= iq[i];
            if (j == 0)
            {
                for (k = 1; jk >= k && iq[jk - k] == 0; k++) { }
                for (i = jz + 1; i <= jz + k; i++)
                {
                    f[jx + i] = ipio2[jv + i];
                    for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
                    q[i] = fw;
                }
                jz += k;
                goto recompute;
            }
        }
        if (z == 0.0)
        {
            jz -= 1;
            q0 -= 24;
            while (iq[jz] == 0) { jz--; q0 -= 24; }
        }
        else
        {
            z = Math.ScaleB(z, -q0);
            if (z >= two24)
            {
                fw = (double)(int)(twon24 * z);
                iq[jz] = (int)(z - two24 * fw);
                jz += 1;
                q0 += 24;
                iq[jz] = (int)fw;
            }
            else iq[jz] = (int)z;
        }
        fw = Math.ScaleB(one, q0);
        for (i = jz; i >= 0; i--) { q[i] = fw * iq[i]; fw *= twon24; }
        for (i = jz; i >= 0; i--)
        {
            for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k] * q[i + k];
            fq[jz - i] = fw;
        }
        switch (prec)
        {
            case 0:
                fw = 0.0;
                for (i = jz; i >= 0; i--) fw += fq[i];
                y[0] = (ih == 0) ? fw : -fw;
                break;
            case 1:
            case 2:
                fw = 0.0;
                for (i = jz; i >= 0; i--) fw += fq[i];
                y[0] = (ih == 0) ? fw : -fw;
                fw = fq[0] - fw;
                for (i = 1; i <= jz; i++) fw += fq[i];
                y[1] = (ih == 0) ? fw : -fw;
                break;
            case 3:
                for (i = jz; i > 0; i--) { fw = fq[i - 1] + fq[i]; fq[i] += fq[i - 1] - fw; fq[i - 1] = fw; }
                for (i = jz; i > 1; i--) { fw = fq[i - 1] + fq[i]; fq[i] += fq[i - 1] - fw; fq[i - 1] = fw; }
                for (fw = 0.0, i = jz; i >= 2; i--) fw += fq[i];
                if (ih == 0) { y[0] = fq[0]; y[1] = fq[1]; y[2] = fw; }
                else { y[0] = -fq[0]; y[1] = -fq[1]; y[2] = -fw; }
                break;
        }
        return n & 7;
    }

    // ---------------------------------------------------------------- __kernel_cos / __kernel_sin / __kernel_tan
    static double KernelCos(double x, double y)
    {
        const double one = 1.0,
            C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
            C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
        double a, iz, z, r, qx;
        int ix = Hi(x) & 0x7FFFFFFF;
        if (ix < 0x3E400000) { if ((int)x == 0) return one; }
        z = x * x;
        r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
        if (ix < 0x3FD33333) return one - (0.5 * z - (z * r - x * y));
        if (ix > 0x3FE90000) qx = 0.28125;
        else qx = FromWords(ix - 0x00200000, 0);
        iz = 0.5 * z - qx;
        a = one - qx;
        return a - (iz - (z * r - x * y));
    }

    static double KernelSin(double x, double y, int iy)
    {
        const double half = 0.5,
            S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
            S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
        double z, r, v;
        int ix = Hi(x) & 0x7FFFFFFF;
        if (ix < 0x3E400000) { if ((int)x == 0) return x; }
        z = x * x;
        v = z * x;
        r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
        if (iy == 0) return x + v * (S1 + z * r);
        return x - ((z * (half * y - v * r) - y) - v * S1);
    }

    static readonly double[] T = {
        3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02, 2.18694882948595424599e-02,
        8.86323982359930005737e-03, 3.59207910759131235356e-03, 1.45620945432529025516e-03, 5.88041240820264096874e-04,
        2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
        2.59073051863633712884e-05,
    };

    static double KernelTan(double x, double y, int iy)
    {
        const double one = 1.0, pio4 = 7.85398163397448278999e-01, pio4lo = 3.06161699786838301793e-17;
        double z, r, v, w, s;
        int hx = Hi(x), ix = hx & 0x7FFFFFFF;
        if (ix < 0x3E300000)
        {
            if ((int)x == 0)
            {
                uint low = Lo(x);
                if (((ix | (int)low) | (iy + 1)) == 0) return one / Math.Abs(x);
                if (iy == 1) return x;
                double a, t;
                z = w = x + y;
                z = SetLo(z, 0);
                v = y - (z - x);
                t = a = -one / w;
                t = SetLo(t, 0);
                s = one + t * z;
                return t + a * (s + t * v);
            }
        }
        if (ix >= 0x3FE59428)
        {
            if (hx < 0) { x = -x; y = -y; }
            z = pio4 - x;
            w = pio4lo - y;
            x = z + w;
            y = 0.0;
        }
        z = x * x;
        w = z * z;
        r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
        v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
        s = z * x;
        r = y + z * (s * (r + v) + y);
        r += T[0] * s;
        w = x + r;
        if (ix >= 0x3FE59428)
        {
            v = iy;
            return (1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r)));
        }
        if (iy == 1) return w;
        {
            double a, t;
            z = w;
            z = SetLo(z, 0);
            v = r - (z - x);
            t = a = -1.0 / w;
            t = SetLo(t, 0);
            s = 1.0 + t * z;
            return t + a * (s + t * v);
        }
    }

    // ---------------------------------------------------------------- sin / cos / tan
    public static double Sin(double x)
    {
        Span<double> y = stackalloc double[2];
        int ix = Hi(x) & 0x7FFFFFFF;
        if (ix <= 0x3FE921FB) return KernelSin(x, 0.0, 0);
        if (ix >= 0x7FF00000) return x - x;
        int n = RemPio2(x, y);
        switch (n & 3)
        {
            case 0: return KernelSin(y[0], y[1], 1);
            case 1: return KernelCos(y[0], y[1]);
            case 2: return -KernelSin(y[0], y[1], 1);
            default: return -KernelCos(y[0], y[1]);
        }
    }

    public static double Cos(double x)
    {
        Span<double> y = stackalloc double[2];
        int ix = Hi(x) & 0x7FFFFFFF;
        if (ix <= 0x3FE921FB) return KernelCos(x, 0.0);
        if (ix >= 0x7FF00000) return x - x;
        int n = RemPio2(x, y);
        switch (n & 3)
        {
            case 0: return KernelCos(y[0], y[1]);
            case 1: return -KernelSin(y[0], y[1], 1);
            case 2: return -KernelCos(y[0], y[1]);
            default: return KernelSin(y[0], y[1], 1);
        }
    }

    public static double Tan(double x)
    {
        Span<double> y = stackalloc double[2];
        int ix = Hi(x) & 0x7FFFFFFF;
        if (ix <= 0x3FE921FB) return KernelTan(x, 0.0, 1);
        if (ix >= 0x7FF00000) return x - x;
        int n = RemPio2(x, y);
        return KernelTan(y[0], y[1], 1 - ((n & 1) << 1));
    }

    // ---------------------------------------------------------------- exp
    public static double Exp(double x)
    {
        const double one = 1.0,
            o_threshold = 7.09782712893383973096e+02, u_threshold = -7.45133219101941108420e+02,
            invln2 = 1.44269504088896338700e+00,
            P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
            P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08,
            E = 2.718281828459045,
            huge = 1.0e+300, twom1000 = 9.33263618503218878990e-302, two1023 = 8.988465674311579539e307;
        double halF0 = 0.5, halF1 = -0.5;
        double ln2HI0 = 6.93147180369123816490e-01, ln2HI1 = -6.93147180369123816490e-01;
        double ln2LO0 = 1.90821492927058770002e-10, ln2LO1 = -1.90821492927058770002e-10;

        double y, hi = 0.0, lo = 0.0, c, t, twopk;
        int k = 0, xsb;
        uint hx = (uint)Hi(x);
        xsb = (int)((hx >> 31) & 1);
        hx &= 0x7FFFFFFF;
        if (hx >= 0x40862E42)
        {
            if (hx >= 0x7FF00000)
            {
                uint lx = Lo(x);
                if (((hx & 0xFFFFF) | lx) != 0) return x + x;
                return (xsb == 0) ? x : 0.0;
            }
            if (x > o_threshold) return huge * huge;
            if (x < u_threshold) return twom1000 * twom1000;
        }
        if (hx > 0x3FD62E42)
        {
            if (hx < 0x3FF0A2B2)
            {
                if (x == 1.0) return E;
                hi = x - (xsb == 0 ? ln2HI0 : ln2HI1);
                lo = xsb == 0 ? ln2LO0 : ln2LO1;
                k = 1 - xsb - xsb;
            }
            else
            {
                k = (int)(invln2 * x + (xsb == 0 ? halF0 : halF1));
                t = k;
                hi = x - t * ln2HI0;
                lo = t * ln2LO0;
            }
            x = hi - lo;
        }
        else if (hx < 0x3E300000)
        {
            if (huge + x > one) return one + x;
        }
        else k = 0;

        t = x * x;
        if (k >= -1021) twopk = FromWords(unchecked(0x3FF00000 + (int)((uint)k << 20)), 0);
        else twopk = FromWords(unchecked(0x3FF00000 + (int)((uint)(k + 1000) << 20)), 0);
        c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
        if (k == 0) return one - ((x * c) / (c - 2.0) - x);
        y = one - ((lo - (x * c) / (2.0 - c)) - hi);
        if (k >= -1021)
        {
            if (k == 1024) return y * 2.0 * two1023;
            return y * twopk;
        }
        return y * twopk * twom1000;
    }

    // ---------------------------------------------------------------- log
    public static double Log(double x)
    {
        const double ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10,
            two54 = 1.80143985094819840000e+16,
            Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01,
            Lg4 = 2.222219843214978396e-01, Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01,
            Lg7 = 1.479819860511658591e-01, zero = 0.0;
        double hfsq, f, s, z, R, w, t1, t2, dk;
        int k, hx, i, j;
        uint lx;
        hx = Hi(x); lx = Lo(x);
        k = 0;
        if (hx < 0x00100000)
        {
            if (((hx & 0x7FFFFFFF) | (int)lx) == 0) return double.NegativeInfinity;
            if (hx < 0) return SignalingNaN;
            k -= 54;
            x *= two54;
            hx = Hi(x);
        }
        if (hx >= 0x7FF00000) return x + x;
        k += (hx >> 20) - 1023;
        hx &= 0x000FFFFF;
        i = (hx + 0x95F64) & 0x100000;
        x = SetHi(x, hx | (i ^ 0x3FF00000));
        k += (i >> 20);
        f = x - 1.0;
        if ((0x000FFFFF & (2 + hx)) < 3)
        {
            if (f == zero)
            {
                if (k == 0) return zero;
                dk = k;
                return dk * ln2_hi + dk * ln2_lo;
            }
            R = f * f * (0.5 - 0.33333333333333333 * f);
            if (k == 0) return f - R;
            dk = k;
            return dk * ln2_hi - ((R - dk * ln2_lo) - f);
        }
        s = f / (2.0 + f);
        dk = k;
        z = s * s;
        i = hx - 0x6147A;
        w = z * z;
        j = 0x6B851 - hx;
        t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
        t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
        i |= j;
        R = t2 + t1;
        if (i > 0)
        {
            hfsq = 0.5 * f * f;
            if (k == 0) return f - (hfsq - s * (hfsq + R));
            return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
        }
        if (k == 0) return f - s * (f - R);
        return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
    }

    // ---------------------------------------------------------------- pow
    static readonly double[] Bp = { 1.0, 1.5 };
    static readonly double[] DpH = { 0.0, 5.84962487220764160156e-01 };
    static readonly double[] DpL = { 0.0, 1.35003920212974897128e-08 };

    public static double Pow(double x, double y)
    {
        const double zero = 0.0, one = 1.0, two = 2.0, two53 = 9007199254740992.0, huge = 1.0e300, tiny = 1.0e-300,
            L1 = 5.99999999999994648725e-01, L2 = 4.28571428578550184252e-01, L3 = 3.33333329818377432918e-01,
            L4 = 2.72728123808534006489e-01, L5 = 2.30660745775561754067e-01, L6 = 2.06975017800338417784e-01,
            P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
            P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08,
            lg2 = 6.93147180559945286227e-01, lg2_h = 6.93147182464599609375e-01, lg2_l = -1.90465429995776804525e-09,
            ovt = 8.0085662595372944372e-0017,
            cp = 9.61796693925975554329e-01, cp_h = 9.61796700954437255859e-01, cp_l = -7.02846165095275826516e-09,
            ivln2 = 1.44269504088896338700e+00, ivln2_h = 1.44269502162933349609e+00, ivln2_l = 1.92596299112661746887e-08;

        double z, ax, z_h, z_l, p_h, p_l;
        double y1, t1, t2, r, s, t, u, v, w;
        int i, j, k, yisint, n;
        int hx, hy, ix, iy;
        uint lx, ly;

        hx = Hi(x); lx = Lo(x);
        hy = Hi(y); ly = Lo(y);
        ix = hx & 0x7fffffff;
        iy = hy & 0x7fffffff;

        if ((iy | (int)ly) == 0) return one;
        if (ix > 0x7ff00000 || ((ix == 0x7ff00000) && (lx != 0)) || iy > 0x7ff00000 || ((iy == 0x7ff00000) && (ly != 0)))
            return x + y;

        yisint = 0;
        if (hx < 0)
        {
            if (iy >= 0x43400000) yisint = 2;
            else if (iy >= 0x3ff00000)
            {
                k = (iy >> 20) - 0x3ff;
                if (k > 20)
                {
                    j = (int)(ly >> (52 - k));
                    if ((j << (52 - k)) == (int)ly) yisint = 2 - (j & 1);
                }
                else if (ly == 0)
                {
                    j = iy >> (20 - k);
                    if ((j << (20 - k)) == iy) yisint = 2 - (j & 1);
                }
            }
        }

        if (ly == 0)
        {
            if (iy == 0x7ff00000)
            {
                if (((ix - 0x3ff00000) | (int)lx) == 0) return y - y;
                else if (ix >= 0x3ff00000) return (hy >= 0) ? y : zero;
                else return (hy < 0) ? -y : zero;
            }
            if (iy == 0x3ff00000)
            {
                if (hy < 0) return one / x;
                return x;
            }
            if (hy == 0x40000000) return x * x;
            if (hy == 0x3fe00000) { if (hx >= 0) return Math.Sqrt(x); }
        }

        ax = Math.Abs(x);
        if (lx == 0)
        {
            if (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000)
            {
                z = ax;
                if (hy < 0) z = one / z;
                if (hx < 0)
                {
                    if (((ix - 0x3ff00000) | yisint) == 0) z = SignalingNaN;
                    else if (yisint == 1) z = -z;
                }
                return z;
            }
        }

        n = (hx >> 31) + 1;
        if ((n | yisint) == 0) return SignalingNaN;
        s = one;
        if ((n | (yisint - 1)) == 0) s = -one;

        if (iy > 0x41e00000)
        {
            if (iy > 0x43f00000)
            {
                if (ix <= 0x3fefffff) return (hy < 0) ? huge * huge : tiny * tiny;
                if (ix >= 0x3ff00000) return (hy > 0) ? huge * huge : tiny * tiny;
            }
            if (ix < 0x3fefffff) return (hy < 0) ? s * huge * huge : s * tiny * tiny;
            if (ix > 0x3ff00000) return (hy > 0) ? s * huge * huge : s * tiny * tiny;
            t = ax - one;
            w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
            u = ivln2_h * t;
            v = t * ivln2_l - w * ivln2;
            t1 = u + v;
            t1 = SetLo(t1, 0);
            t2 = v - (t1 - u);
        }
        else
        {
            double ss, s2, s_h, s_l, t_h, t_l;
            n = 0;
            if (ix < 0x00100000)
            {
                ax *= two53;
                n -= 53;
                ix = Hi(ax);
            }
            n += ((ix) >> 20) - 0x3ff;
            j = ix & 0x000fffff;
            ix = j | 0x3ff00000;
            if (j <= 0x3988E) k = 0;
            else if (j < 0xBB67A) k = 1;
            else { k = 0; n += 1; ix -= 0x00100000; }
            ax = SetHi(ax, ix);

            u = ax - Bp[k];
            v = one / (ax + Bp[k]);
            ss = u * v;
            s_h = ss;
            s_h = SetLo(s_h, 0);
            t_h = zero;
            t_h = SetHi(t_h, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
            t_l = ax - (t_h - Bp[k]);
            s_l = v * ((u - s_h * t_h) - s_h * t_l);
            s2 = ss * ss;
            r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
            r += s_l * (s_h + ss);
            s2 = s_h * s_h;
            t_h = 3.0 + s2 + r;
            t_h = SetLo(t_h, 0);
            t_l = r - ((t_h - 3.0) - s2);
            u = s_h * t_h;
            v = s_l * t_h + t_l * ss;
            p_h = u + v;
            p_h = SetLo(p_h, 0);
            p_l = v - (p_h - u);
            z_h = cp_h * p_h;
            z_l = cp_l * p_h + p_l * cp + DpL[k];
            t = n;
            t1 = (((z_h + z_l) + DpH[k]) + t);
            t1 = SetLo(t1, 0);
            t2 = z_l - (((t1 - t) - DpH[k]) - z_h);
        }

        y1 = y;
        y1 = SetLo(y1, 0);
        p_l = (y - y1) * t1 + y * t2;
        p_h = y1 * t1;
        z = p_l + p_h;
        j = Hi(z); i = (int)Lo(z);
        if (j >= 0x40900000)
        {
            if (((j - 0x40900000) | i) != 0) return s * huge * huge;
            if (p_l + ovt > z - p_h) return s * huge * huge;
        }
        else if ((j & 0x7fffffff) >= 0x4090cc00)
        {
            if ((unchecked((uint)j - 0xc090cc00u) | (uint)i) != 0) return s * tiny * tiny;
            if (p_l <= z - p_h) return s * tiny * tiny;
        }
        i = j & 0x7fffffff;
        k = (i >> 20) - 0x3ff;
        n = 0;
        if (i > 0x3fe00000)
        {
            n = j + (0x00100000 >> (k + 1));
            k = ((n & 0x7fffffff) >> 20) - 0x3ff;
            t = zero;
            t = SetHi(t, n & ~(0x000fffff >> k));
            n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
            if (j < 0) n = -n;
            p_h -= t;
        }
        t = p_l + p_h;
        t = SetLo(t, 0);
        u = t * lg2_h;
        v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
        z = u + v;
        w = v - (z - u);
        t = z * z;
        t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
        r = (z * t1) / ((t1 - two) - (w + z * w));
        z = one - (r - z);
        j = Hi(z);
        j = unchecked(j + (int)((uint)n << 20));
        if ((j >> 20) <= 0) z = Math.ScaleB(z, n);
        else
        {
            int tmp = Hi(z);
            z = SetHi(z, unchecked(tmp + (int)((uint)n << 20)));
        }
        return s * z;
    }
}
