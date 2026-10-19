// The slice of the sim the animator reads (animator.js reads the sim's Player / action / Game objects directly; here
// they are plain data so the port can be driven by the sim port, a Godot node or a parity trace alike).
namespace Rimrift.Anim;

/// Render-interpolated placement (animator.js `st`)
public struct AnimState { public double X, Y, Z, Facing; }

/// The sim's player action (the fields the animator reads). Unused fields stay at their defaults.
public sealed class AnimAction
{
    public string Type = "";
    public double T, Dur = 0.3, TRel, Takeoff, Release, Slam, SlamAt = double.NaN, ReleaseAt = double.NaN, JumpAt, Air, GotAt = double.NaN, HitAt = double.NaN, HopEnd, DRim = double.NaN, FakeAt, Emph = 1, H = 0.7;
    public bool Released, Jumped, Slammed, Fade, Hit, Low, Fall, Screen, Flat, Back, Op, Clamp;
    public string? Kind, Style, Hustle, Post, HookShape, FadeShape, Move, Sty, LStyle, Cov, Icon, BStyle, Lead, LdUsed, PType, React, SpinDirStr;
    public string Hand = "R";
    public int Lvl, Side = 1, CovSide = 1, LsDir = 1, SpinDir = 1, To = -1, Dir = 1;
    public bool HasTakeoff = true; // (a.takeoff ?? x: JS undefined → false)
    public bool HasReleaseAt => !double.IsNaN(ReleaseAt);
}

public sealed class AnimDribble { public string Hand = "R"; public double Phase; public string? Xover; }
public sealed class AnimShotPkg { public string Hand = "R"; public string Style = "standard"; public string Release = "classic"; public double RelK = 0.93; }
public sealed class AnimPhys { public double Reach, H, Radius = 0.3; }

/// The sim player (animator.js `p`)
public sealed class AnimPlayer
{
    public int Id;
    public double Vx, Vz, Facing, Stamina = 1, Screening, Posting, Backing;
    public AnimAction? Action;
    public string Stance = "normal";
    public bool Airborne, HandsUp, BoxOut, BoxedOut, Human;
    public string? MoveStyle, SizeupStyle, ContestHand, ClampFx;
    public int SizeupLvl;
    public double[]? HandsSide; // {x, z}
    public AnimDribble Dribble = new();
    public AnimShotPkg? ShotPkg = new();
    public AnimPhys Phys = new();
}

/// The bits of the Game the animator looks at (animator.js `g`); null = no game (practice / showroom)
public sealed class AnimGame
{
    public int BallHolder = -1;
    public string BallMode = "held";
    public string? BallKind; public int PassTo = -1;
    public double[]? Rim;            // rimFor(p.team)
    public double[]? HolderPos;      // g.holder() {x, z}
    public bool OpponentNear;        // any opponent within 2.2 m (ballHands)
    public double[]? PassTargetPos;  // the pass target's {x, z}
}

public sealed class AnimExtra
{
    public bool HasBall; public string? BallMode; public double FloorY; public double[]? Look;
}

public struct Vec3 { public double X, Y, Z; public Vec3(double x, double y, double z) { X = x; Y = y; Z = z; } }
