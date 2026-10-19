using Rimrift.Anim;
using Xunit;

public class SkeletonTests
{
    [Fact]
    public void BonesAndParents()
    {
        Assert.Equal(21, Skeleton.BONES.Length);
        Assert.Equal("hips", Skeleton.BONES[0]); Assert.Equal("toeR", Skeleton.BONES[20]);
        Assert.Equal(B.chest, Skeleton.PARENT[B.clavL]); Assert.Equal(B.hips, Skeleton.PARENT[B.thighR]);
        for (int i = 1; i < Skeleton.N; i++) Assert.True(Skeleton.PARENT[i] < i, "parents come before children");
    }

    [Fact]
    public void SheetBuildDims()
    {
        var d = Skeleton.BodyDims(new Build(77, 215, 80));
        Assert.Equal(77 * 0.0254, d.H, 12);
        // the modelled wingspan is exactly the build's: 2 x (shoulder + upper + fore + hand)
        Assert.Equal(80 * 0.0254, 2 * (d.ShoulderX + d.UpperLen + d.ForeLen + d.HandLen), 9);
        var bind = Skeleton.BindPositions(Skeleton.BindOffsets(d));
        Assert.Equal(0, bind[B.toeL][1] - 0.012 * d.H, 9); // toes sit 0.012 H off the floor in bind
        Assert.True(bind[B.handL][0] > 0 && bind[B.handR][0] < 0, "left is +X");
        Assert.True(bind[B.head][1] > bind[B.neck][1] && bind[B.neck][1] > bind[B.chest][1]);
    }

    [Fact]
    public void NeutralPoseSolvesStanding()
    {
        var an = new Animator(new Build(77, 215, 80));
        an.Rig.Solve(Pose.Neutral());
        var footL = an.Rig.Pos[B.footL];
        Assert.InRange(footL[1], 0.06, 0.1); // ankle at 0.08 x H/2 off the floor
        Assert.InRange(an.Rig.Pos[B.head][1], 1.6, 1.85);
        Assert.True(an.Rig.Reach[0] < 1e-3 && an.Rig.Reach[1] < 1e-3, "the neutral hands are within reach");
    }

    [Fact]
    public void MirrorIsAnInvolution()
    {
        var a = Pose.Neutral(); a[P.handL] = 0.5f; a[P.spine + 1] = 0.2f; a[P.yawL] = 0.1f;
        var m = Pose.Mirror(Pose.NewPose(), a); var mm = Pose.Mirror(Pose.NewPose(), m);
        for (int i = 0; i < P.N; i++) Assert.Equal(a[i], mm[i]);
        Assert.Equal(-0.5f, m[P.handR]); Assert.Equal(-0.2f, m[P.spine + 1]);
    }
}
