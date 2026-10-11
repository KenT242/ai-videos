# Blender 5.2 API notes (verified on this machine, 2026-10-10)

Paste the blocks a task needs into the brief. Each was run here; the gotchas are what cost agy (or me) time.


### Picture -> Grease Pencil (design from an image instead of coordinates)
Shapes typed as coordinates look crude (the 2026-10-10 cat rig); for characters start from a picture.
1. Vectorize (me, in WSL): `uv run -q --no-project --python 3.12 --with vtracer --with pillow --with svgpathtools python -I ~/.claude/skills/blender/scripts/vectorize.py <image> /mnt/e/Downloads/<name>.svg [--mirror] [--drop "#RRGGBB"]` (cutout mode by default). Then render a preview with cairosvg on a saturated background and look at it before handing it to agy. Suits flat cartoon art (few colours, clear outlines, plain background).
2. Import (agy):
```python
bpy.context.scene.frame_set(1)   # FIRST: the import keys its drawing at the CURRENT frame; at another frame the object is invisible at frame 1
bpy.ops.wm.grease_pencil_import_svg(filepath=r"E:\Downloads\<name>.svg", resolution=10, scale=10.0, use_scene_unit=False, recenter_bounds=True)
obj = bpy.context.active_object  # named after the file, e.g. 'meo_vector.svg'; lies in XZ facing the camera, upright
```
   Worked directly from the MCP context (no temp_override needed). One material 'Fill'; colours live in the per-stroke `fill_color` attribute.
   A drawing at the wrong frame: `layer.frames.move(6, 1)` (ints; `frame.frame_number` is read-only).
3. Size/place: `obj.dimensions` is right; `obj.bound_box` is all zeros for GP v3 objects (even evaluated). For world bounds use stroke points: `obj.matrix_world @ p.position` over `drawing.strokes[i].points` (points have `position`, not `co`).
Measured: 468 s when agy hit the frame trap and went digging; the import itself was right after 28 s.


### Mode
```python
if bpy.context.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
```

### Grease Pencil v3 object + stroke
```python
gp = bpy.data.grease_pencils.new("Ball")
obj = bpy.data.objects.new("Ball", gp)
bpy.context.scene.collection.objects.link(obj)

mat = bpy.data.materials.new("Ball_Mat")
bpy.data.materials.create_gpencil_data(mat)        # returns None; mat.grease_pencil now exists
mat.grease_pencil.color = (0.05, 0.05, 0.05, 1)    # stroke (outline) colour
mat.grease_pencil.fill_color = (0.9, 0.1, 0.1, 1)  # fill colour
gp.materials.append(mat)

drawing = gp.layers.new("Ball").frames.new(1).drawing   # frames.new(frame_number)
drawing.add_strokes([32])                          # list of point counts
s = drawing.strokes[0]
s.cyclic = True
s.material_index = 0
for i, p in enumerate(s.points):
    t = 2 * math.pi * i / 32
    p.position = (0.5 * math.cos(t), 0.0, 0.5 * math.sin(t))   # 2D template camera looks along +Y → draw in XZ
    p.radius = 0.02
s.fill_id = 1      # REQUIRED for a visible fill; UNIQUE per filled stroke in a drawing (see gotcha)
# s.hide_stroke = True   # fill only, no outline
```
**Gotcha:** in 5.2, `material.grease_pencil.show_fill` / `show_stroke` don't control what's drawn (the built-in Monkey has them all False and still shows fills). A stroke draws its fill only when `stroke.fill_id != 0`; `stroke.hide_stroke` hides its outline. Without `fill_id` you get an outline-only circle.
**Gotcha 2:** strokes in one drawing that share a `fill_id` are merged into ONE fill region (overlaps become holes, colours mix up). Give every filled stroke its own id (`fill_id = i + 1`). Within a drawing, later strokes draw on top.

### Keyframes and F-curves (layered actions)
`action.fcurves` no longer exists (AttributeError). Insert keys as usual, then reach F-curves via the channelbag:
```python
obj.location = (x, 0, z); obj.keyframe_insert("location", frame=f)
obj.scale = (sx, 1, sz);  obj.keyframe_insert("scale", frame=f)

act = obj.animation_data.action
cb = act.layers[0].strips[0].channelbag(act.slots[0])
for fc in cb.fcurves:                 # fc.data_path, fc.array_index
    for kp in fc.keyframe_points:     # kp.co = (frame, value)
        kp.interpolation = 'BEZIER'   # or 'LINEAR', 'CONSTANT'
        kp.handle_left_type = kp.handle_right_type = 'VECTOR'   # sharp; 'AUTO_CLAMPED' = smooth/slow
    fc.update()
```

### Scene range / verification
```python
sc = bpy.context.scene; sc.frame_start, sc.frame_end = 1, 48
for f in (1, 12, 24): sc.frame_set(f); print(f, tuple(round(v, 2) for v in obj.location), tuple(round(v, 2) for v in obj.scale))
sc.frame_set(1)
```

### Rigging a Grease Pencil drawing with an armature (verified 2026-10-10)
- Vectorize with `hierarchical="cutout"` for anything that will be deformed. The default `stacked` mode layers big hidden shapes under the visible ones (e.g. one dark shape spanning both near legs); when bones pull its points apart it folds and the hidden layer shows as torn dark patches. In cutout mode each colour region is its own stroke, side by side; cutout also emits the sticker/background shapes, so drop the full-canvas background and stray light-grey bits by colour + size.
- Plan the bones on the picture first: draw the chains over the preview PNG (PIL) and look before briefing. Image px -> world: x = xmin + (px - px_min) * k, z = zmin + (py_max - py) * k, with k = world width / px width.
```python
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones.new("legFN_up"); eb.head = (x, 0, z); eb.tail = (x, 0, z); eb.parent = ...; eb.use_connect = ...
eb.align_roll((0.0, -1.0, 0.0))   # local Z -> camera: rotation_euler.z > 0 = counter-clockwise on screen (a leg swings forward to +X)
bpy.ops.object.mode_set(mode='OBJECT')
gp_obj.vertex_groups.new(name="legFN_up")
drawing.set_vertex_weights("legFN_up", indices, weights, assign_mode='REPLACE')   # flat point indices over all strokes; pass every index (0.0 where none) to overwrite
m = gp_obj.modifiers.new("Armature", 'GREASE_PENCIL_ARMATURE'); m.object = rig     # not 'ARMATURE'
```
- **Gotcha:** a pose bone rotates in its own axes and local Y runs along the bone; rotating about Y only twists it and nothing visibly moves. Without `align_roll` a roll-0 bone pointing down swings in XZ on local Z but horizontal bones don't; align every bone as above.
- Weights per point: `raw = 1/(d^2+0.002)^2` from the 2D distance to each candidate bone segment, keep the top 2, normalise. Scale leg bones by a band factor (smoothstep z hip-0.1 → hip-0.35) so belly/back stay on the spine.
- **Overlapping limbs need stroke classes, not distance:** list strokes (index, colour, bounds) yourself, name the far-limb strokes (here the darker brown ones) in the brief: far-limb strokes may only use their own limb chain (+ spine above the band); every other stroke is barred from far-limb bones. Pure distance tore the front legs (the thin near leg sits beside the far one).
- Review by isolating: pose one bone at a time, `look` each, compare crops side by side.
- Measured: stacked import tore; cutout + distance tore at the front legs; cutout + stroke classes was clean (each agy stage ~90-125 s, 4-6 tool calls).

### Motion preview (MP4) for review
`scripts/render_preview.py` (run via `execute_blender_code '{"code":"@<copy with OUT edited>"}'`) renders the frame range with the scene engine to MP4 and restores settings: 72 frames of the 2D scene in ~12 s at 50 %.
- **Gotcha:** `bpy.ops.render.opengl(animation=True)` draws the viewport in Solid shading: Grease Pencil comes out as grey silhouettes (useful only as a silhouette-readability check). Use `bpy.ops.render.render(animation=True)`.
- Output format: `image_settings.media_type = 'VIDEO'`, `file_format = 'FFMPEG'`, `ffmpeg.format = 'MPEG4'`, `ffmpeg.codec = 'H264'`. Read enums from `bl_rna` rather than guessing.
- Review it with `scripts/video_sheet.py` (contact sheet) and give the user the MP4 path to watch.

### Verifying an API yourself (temp objects)
Create `Tmp*` objects at frame 1 (`scene.frame_set(1)` first), test, `look`, then remove the objects AND their datablocks (`bpy.data.grease_pencils/armatures/meshes`). A wrong test is worse than none: a pose rotation about the bone's own Y axis "proved" the armature modifier broken for ten calls.
