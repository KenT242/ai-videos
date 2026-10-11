# Animation notes (2D, Grease Pencil)

## Bouncing ball (worked, 58 s via agy)
- Contact keys `VECTOR` handles (fast at the ground), peak keys `AUTO_CLAMPED` (slow at the top), horizontal drift `LINEAR`.
- Squash keeps the ball on the ground: radius r, ground z=g → centre at `g + r*scale_z` (r=0.5, squash 0.7 → g+0.35).
- Squash (1.3,1,0.7) at contact, stretch (0.85,1,1.2) one frame either side, (1,1,1) at peaks.

## Walk cycle on a bone-deformed drawing: what we did and why it looked bad
Table used (24-frame loop, keys 1/7/13/19/25, rotation_euler.z degrees, + = forward): `legBN_up`/`legFF_up` +20,0,-20,0,+20, `legBF_up`/`legFN_up` opposite; lower legs -25 at mid-swing (BN/FF f19, BF/FN f7); spine ±1.5; head ±3; tail1 +8,0,-8,0,+8, tail2 0,+10,0,-10,0, tail3 -6,0,+6,0,-6; rig z bob 0/+0.06; Cycles modifiers; rig travel x LINEAR -2.9→2.9 over 72 frames. agy keyed it correctly in 58 s. The user judged the result "quá tệ". Measured causes:
- **Paws float and bob during stance**: forward kinematics from the hip swings each paw on an arc. Stance-phase paw height ranged 0.10–0.26 and never reached the ground (z -1.60…-1.93 vs ground -2.0).
- **Sliding**: stance paw x travel -0.09…+0.19 (front-near worst).
- **Rest pose is mid-stride**: the source picture's legs are already spread, so oscillating around it never passes through clean contact/passing poses.
- **Deforming one flat drawing**: stripes smear, outlines thin or gap, a stray outline dangles; parts that were never drawn (the far legs' hidden tops) can't appear.
- **Timing designed blind** from a generic table and reviewed on 8 stills, never in motion.

## Quality checks to run before showing anything
1. **Watch it**: `scripts/render_preview.py` → MP4 → `scripts/video_sheet.py`, and give the user the MP4.
2. **Paw planting** (numbers, per leg over its stance frames):
```python
for f in range(f0, f1 + 1):
    sc.frame_set(f); p = rig.matrix_world @ rig.pose.bones["legBN_lo"].tail
    # want: p.x constant (|travel| < 0.03) and p.z == ground (± 0.02)
```
3. **Speed matches stride**: rig speed per frame ≈ paw travel relative to the body during stance / stance frames.
4. **Silhouette**: `render.opengl` (grey silhouettes) shows whether poses read.

## What a walk needs that the cutout approach lacked
- IK on the legs (an IK constraint on each `*_lo` targeting a foot controller bone whose world position is keyed planted during stance), or keyed foot positions, instead of hip rotations only.
- Key poses first (contact, down, passing, up) and judge them as stills, then timing in motion.
- Source art made for rigging: side view, neutral standing pose, each part on its own layer/file (body, head, tail, each leg upper/lower) with overlapping ends and hidden parts drawn in. With such art, parent parts to bones rigidly; no weight painting, no tearing.
