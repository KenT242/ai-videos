# Run inside Blender (execute_blender_code '{"code":"@.../render_preview.py"}').
# Renders the scene's frame range with the scene's engine (EEVEE in the 2D template) to an MP4
# so motion can be judged - still frames hide sliding feet and bad timing. Restores every
# render setting it touches. Edit OUT / PCT before running.
import bpy

OUT = r"E:\Downloads\preview.mp4"
PCT = 50

sc = bpy.context.scene
r = sc.render
im = r.image_settings
saved = (r.filepath, im.media_type, im.file_format, r.ffmpeg.format, r.ffmpeg.codec, r.resolution_percentage)
try:
    im.media_type = 'VIDEO'
    im.file_format = 'FFMPEG'
    r.ffmpeg.format = 'MPEG4'
    r.ffmpeg.codec = 'H264'
    r.resolution_percentage = PCT
    r.filepath = OUT
    # Not render.opengl: that draws the viewport in Solid shading, so Grease Pencil comes out as grey silhouettes.
    bpy.ops.render.render(animation=True)
    print("wrote", bpy.path.abspath(OUT), "frames", sc.frame_start, "-", sc.frame_end)
finally:
    r.filepath, im.media_type, im.file_format, r.ffmpeg.format, r.ffmpeg.codec, r.resolution_percentage = saved
