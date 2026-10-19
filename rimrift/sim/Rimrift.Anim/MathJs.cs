// The subset of client/js/core/math.js the rig uses, with the JS numerics kept: quaternions and matrices are
// Float32Array in the JS (float[] here, every store rounds to single), vectors are plain arrays (double).
// Hypot follows V8's Math.hypot (scale by the largest, Kahan-summed squares) so values match to the ulp.
namespace Rimrift.Anim;

public static class JsMath
{
    // V8-exact transcendental functions and hypot: Rimrift.Sim.JsMath (the Rules agent's, bit-exact against Node)
    public static double Hypot(double a, double b) => Rimrift.Sim.JsMath.Hypot(a, b);
    public static double Hypot(double a, double b, double c) => Rimrift.Sim.JsMath.Hypot(a, b, c);
    public static double Hypot(double a, double b, double c, double d) => Rimrift.Sim.JsMath.Hypot(a, b, c, d);
    public static double Sin(double x) => Rimrift.Sim.JsMath.Sin(x);
    public static double Cos(double x) => Rimrift.Sim.JsMath.Cos(x);
    public static double Exp(double x) => Rimrift.Sim.JsMath.Exp(x);
    public static double Pow(double x, double y) => Rimrift.Sim.JsMath.Pow(x, y);
    public static double Hypot(double[] v) => Hypot(v[0], v[1], v[2]);
    public static double Clamp(double v, double a, double b) => v < a ? a : v > b ? b : v;
    public static double Lerp(double a, double b, double t) => a + (b - a) * t;
    public static double Round(double x) => Rimrift.Sim.JsMath.Round(x);

    // ---- vec3 (double[3]) ----
    public static double[] Norm(double[] v) { double l = Hypot(v[0], v[1], v[2]); if (l == 0) l = 1; return new[] { v[0] / l, v[1] / l, v[2] / l }; }
    public static double[] Cross(double[] a, double[] b) => new[] { a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] };
    public static double Dot(double[] a, double[] b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    public static double[] V3(double x, double y, double z) => new[] { x, y, z };

    // ---- quat (float[4], x y z w) ----
    public static float[] Q4() => new float[] { 0, 0, 0, 1 };
    public static float[] QCopy(float[] o, float[] a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; return o; }
    public static float[] QMul(float[] o, float[] a, float[] b)
    {
        double ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
        o[0] = (float)(ax * bw + aw * bx + ay * bz - az * by);
        o[1] = (float)(ay * bw + aw * by + az * bx - ax * bz);
        o[2] = (float)(az * bw + aw * bz + ax * by - ay * bx);
        o[3] = (float)(aw * bw - ax * bx - ay * by - az * bz);
        return o;
    }
    public static float[] QAxis(float[] o, double ax, double ay, double az, double rad)
    {
        double s = Sin(rad / 2);
        o[0] = (float)(ax * s); o[1] = (float)(ay * s); o[2] = (float)(az * s); o[3] = (float)Cos(rad / 2); return o;
    }
    public static float[] QNorm(float[] o, float[] a)
    {
        double l = Hypot(a[0], a[1], a[2], a[3]); if (l == 0) l = 1;
        o[0] = (float)(a[0] / l); o[1] = (float)(a[1] / l); o[2] = (float)(a[2] / l); o[3] = (float)(a[3] / l); return o;
    }
    public static float[] QInvert(float[] o, float[] a) { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; o[3] = a[3]; return o; }
    /// Euler in radians, intrinsic Y then X then Z (q = qy * qx * qz)
    public static float[] QEuler(float[] o, double x, double y, double z)
    {
        double cx = Cos(x / 2), sx = Sin(x / 2), cy = Cos(y / 2), sy = Sin(y / 2), cz = Cos(z / 2), sz = Sin(z / 2);
        o[0] = (float)(cy * sx * cz + sy * cx * sz);
        o[1] = (float)(sy * cx * cz - cy * sx * sz);
        o[2] = (float)(cy * cx * sz - sy * sx * cz);
        o[3] = (float)(cy * cx * cz + sy * sx * sz);
        return o;
    }
    public static float[] QSlerp(float[] o, float[] a, float[] b, double t)
    {
        double bx = b[0], by = b[1], bz = b[2], bw = b[3];
        double cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
        if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
        double s0, s1;
        if (cos > 0.9995) { s0 = 1 - t; s1 = t; }
        else { double om = Math.Acos(cos), so = Sin(om); s0 = Sin((1 - t) * om) / so; s1 = Sin(t * om) / so; }
        o[0] = (float)(s0 * a[0] + s1 * bx); o[1] = (float)(s0 * a[1] + s1 * by); o[2] = (float)(s0 * a[2] + s1 * bz); o[3] = (float)(s0 * a[3] + s1 * bw);
        return QNorm(o, o);
    }
    /// v3transformQuat into a double[3]
    public static double[] QRot(float[] q, double[] a)
    {
        double qx = q[0], qy = q[1], qz = q[2], qw = q[3], x = a[0], y = a[1], z = a[2];
        double uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x;
        double uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx;
        return new[] { x + 2 * (qw * uvx + uuvx), y + 2 * (qw * uvy + uuvy), z + 2 * (qw * uvz + uuvz) };
    }

    // ---- mat4 (float[16], column-major) ----
    public static float[] M4() { var m = new float[16]; m[0] = m[5] = m[10] = m[15] = 1; return m; }
    public static float[] M4Mul(float[] o, float[] a, float[] b)
    {
        double a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
            a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        for (int i = 0; i < 4; i++)
        {
            double b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
            o[i * 4] = (float)(b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30);
            o[i * 4 + 1] = (float)(b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31);
            o[i * 4 + 2] = (float)(b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32);
            o[i * 4 + 3] = (float)(b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33);
        }
        return o;
    }
    public static float[] M4Compose(float[] o, double[] p, float[] q)
    {
        double x = q[0], y = q[1], z = q[2], w = q[3], x2 = x + x, y2 = y + y, z2 = z + z;
        double xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
        o[0] = (float)(1 - (yy + zz)); o[1] = (float)(xy + wz); o[2] = (float)(xz - wy); o[3] = 0;
        o[4] = (float)(xy - wz); o[5] = (float)(1 - (xx + zz)); o[6] = (float)(yz + wx); o[7] = 0;
        o[8] = (float)(xz + wy); o[9] = (float)(yz - wx); o[10] = (float)(1 - (xx + yy)); o[11] = 0;
        o[12] = (float)p[0]; o[13] = (float)p[1]; o[14] = (float)p[2]; o[15] = 1;
        return o;
    }
    public static float[] M4FromYaw(float[] o, double x, double y, double z, double yaw, double s = 1)
    {
        double c = Cos(yaw), sn = Sin(yaw);
        Array.Fill(o, 0f); o[0] = (float)(c * s); o[2] = (float)(-sn * s); o[5] = (float)s; o[8] = (float)(sn * s); o[10] = (float)(c * s); o[12] = (float)x; o[13] = (float)y; o[14] = (float)z; o[15] = 1; return o;
    }
}
