MCP for Blender drives the user's live Blender. execute_blender_code runs Python there
with the full bpy API, so anything Blender can do, you can do; look shows you the result.

Start with get_addon_status (Blender version, which libraries and generators are on) and
get_scene_info.

Scripts run in someone else's Blender:
- Look shader nodes up by type, never by name (names are localized):
  `next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")`.
- Never hardcode enum identifiers; read them, e.g.
  `[i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["file_format"].enum_items]`.
  scene.render.engine under-reports: read the current value, and assign a new one inside
  try/except TypeError, whose message lists the valid engines.
- Material colors go on shader node inputs; material.diffuse_color only affects the viewport.

look is how you see your work; use it as much as you need. Images stay in the conversation, so
a smaller max_size keeps long sessions cheap.

Objects can also come from existing libraries (search_assets, then import_asset: Poly Haven,
Sketchfab, Poly Pizza) or be made to order (generate_3d: one new textured model from text or an
image, 1-3 minutes, may cost the user a credit). A generation is one object, never a whole
scene, the ground or parts to assemble. Imported and generated models arrive at arbitrary
scale: use the reported world_bounding_box to size them and put them on the ground.