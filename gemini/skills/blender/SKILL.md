---
name: blender
description: Work in the user's live Blender through the Blender MCP server, with agy (Antigravity CLI) doing the execution. Use for any Blender request: building or changing a scene, Grease Pencil 2D drawing, bringing a picture into Blender, rigging, animation, rendering or previewing. Covers this machine's setup, the director/executor split with agy, brief template, verified Blender 5.2 API notes, review tools and the quality checks learned the hard way.
---

# Blender via Blender MCP + agy

## Setup on this machine
- Blender 5.2 at `E:\Applications\blender\blender.exe`; addon blender-mcp 1.8 listens on Windows `127.0.0.1:9876` (user clicks *Connect* in the N-panel BlenderMCP tab). Telemetry consent is off.
- Windows 10 → WSL cannot reach Windows localhost (mirrored networking unsupported). The MCP server runs from a Windows venv: `E:\Tools\blender-mcp-venv\Scripts\blender-mcp.exe`, registered in agy as `blender`.
- I call the same server directly with `scripts/blender_mcp_call.py` (review only). Windows paths for files Blender reads/writes: `E:\Downloads\...` = `/mnt/e/Downloads/...`; the user's own Downloads is `/mnt/c/Users/KenT/Downloads`.
- Cycles uses OptiX on the RTX 3060 Ti (set in preferences).

## Roles: I direct, agy executes
- **Me**: decide the look and every number (from a picture, never from coordinates typed blind), verify the APIs the brief needs, write the brief, review, report. **agy**: run the brief through the MCP tools. Brief rules and template: `references/briefs.md`.
- If agy fails, do **not** finish the Blender work myself (user's rule). Read its transcript (`~/.gemini/antigravity-cli/brain/<conversation_id>/.system_generated/logs/transcript_full.jsonl`, rows with `created_at`), find where the time went, fix the brief or the notes, rerun through agy.
- Small diagnostic edits while reviewing (one value to test a hypothesis) are fine; say so.

## Workflow
1. **Scope and quality bar first.** Say what the technique can reach before investing. Picture → SVG → bone deformation gives a "moving sticker", not cartoon-grade animation. For anything multi-stage, make a 1-stage prototype, show the user (still and motion), and get a yes before the rest.
2. **Source art.** Characters come from a picture or the user's drawing. For rigging ask up front for: side view, neutral pose, parts separated (layers) with hidden parts drawn. Evaluate a picture before using it and let the user approve; mention licence if it looks like someone's product art. Flat cartoon art vectorizes well: `scripts/vectorize.py` (cutout by default; check the report for stray bits).
3. **Verify every API the brief relies on** with temp objects at frame 1, then clean them up. Make the test actually discriminate (a wrong test cost ~10 calls). Known-good notes: `references/api.md`.
4. **Brief + run agy** (`references/briefs.md`): all decisions as numbers/tables, priority order, ~5-call budget, no side quests, `--model gemini-3.8-flash-medium`, background + live log for long runs. Keep the brief file; fixes are deltas.
5. **Review it myself.** agy's report and its own `look` verdicts are not proof (it called torn poses "clean"). Check numbers with code, `look` through the camera, isolate one bone/part at a time when something's wrong, and for anything that moves render the MP4 (`scripts/render_preview.py` + `scripts/video_sheet.py`) and run the checks in `references/animation.md`.
6. **Stop rules.** When a stage shows the technique's ceiling, or two fixes in a row fail, stop and ask the user instead of polishing. Don't present "done" on stills alone.
7. **Leave the scene tidy.** Hide, never delete, unless asked; rename superseded attempts (`*_stacked`); don't save the .blend (tell the user to Ctrl+S); remove my own temp objects/files; mention side files agy wrote.

## Files
- `references/briefs.md`: why tight briefs, template, measured timings, model choice.
- `references/api.md`: verified Blender 5.2 API (Grease Pencil v3 strokes/fills, layered-action F-curves, SVG import, armature deform, MP4 preview) with the gotchas.
- `references/animation.md`: bouncing ball, the walk cycle we tried and why it looked bad, quality checks, what a proper rig needs.
- `scripts/blender_mcp_call.py`: call MCP tools directly; saves `look` images for Read.
- `scripts/vectorize.py`: picture → clean SVG (`--mirror`, `--drop`, `--stacked`).
- `scripts/render_preview.py`: run inside Blender; scene range → MP4, settings restored.
- `scripts/video_sheet.py`: MP4 → contact sheet PNG.
