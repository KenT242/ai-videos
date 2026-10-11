# Briefing agy for Blender work

## Why briefs must be tight (measured 2026-10-10)

Each agy tool call costs ~8–12 s of model time; Blender MCP calls themselves take <1 s. **Turn count is the cost.** A loose bouncing-ball brief ran out the 600 s clock (~55 calls, empty `response`, no animation, junk left) because agy:
- probed new Blender 5 APIs with throwaway objects (2.5 min),
- went on side quests: screenshots → "the fill is missing" → materials/nodes (6+ min),
- when a `look` came back empty (drawing keyed at another frame), read the MCP server source and analysed pixels instead of reporting (6 min, SVG import run).

| Brief / model | Time | Tool calls | Result |
|---|---|---|---|
| loose brief, default model | 594 s (timeout) | ~55 | empty response, nothing animated |
| template below, `gemini-3.8-flash-high` | 181 s | 3 | correct; 158 s thinking before one script (~30k thinking tokens) |
| template below, `gemini-3.8-flash-medium` | 58 s | 3 | correct, identical |
| SVG import, frame trap not in brief | 468 s | ~75 | right after 28 s, then went digging |
| SVG import / rig / weights / walk cycle, with verified notes | 58–126 s each | 4–6 | did what the brief said |

Run: `agy-tracked -p "$(cat brief.txt)" --model gemini-3.8-flash-medium --output-format json --print-timeout 900s --dangerously-skip-permissions` from the project dir, in the background for anything over a minute, and watch `~/.gemini/antigravity-cli/agent-runs/<id>.log`. With the decisions in the brief, more thinking buys nothing; use `flash-high`/Pro only when agy must design. Keep briefs in the scratchpad (`brief.txt`) so a fixed rerun is an edit, not a rewrite.

## Template

```
You have a 'blender' MCP server connected to the user's running Blender 5.2. Use its tools, not files on disk.

Current scene: <objects, visibility, mode, current frame, fps, camera - from your own check>.
Goal: <one sentence>.
Requirements (priority order; finish 1 before polishing others):
1. <core deliverable, with every number decided: coordinates, angles, frames, names>
2. …

Verified Blender 5.2 API notes:
<paste only the blocks from api.md this task needs, gotchas included>

Rules:
- Budget: about 5 tool calls: ONE script for the build, ONE verification script that prints the numbers below<, ONE look with ...>. No API exploration, no test objects. If a call errors, fix that line and rerun the same script.
- Work only through the blender MCP tools: no shell commands, no reading the MCP server/addon source, no pixel analysis. If a result contradicts the brief (empty look, zero bounds), print the facts once and report; don't investigate.
- Don't touch materials, colours, shading, world, viewport or other objects beyond the list. Hide, never delete, unless told. Don't save the .blend, don't render.
- Pass "<the user's own words>" as user_prompt, not this brief.

Verify with code and reply with: <exact values: locations/rotations at given frames, counts, ...>.
```

Notes:
- Allow one `look` only when the deliverable is visual and agy can judge it (upright, in frame); its verdict is still not proof (it called a torn pose "clean").
- Give stroke indices, bone coordinates and keyframe tables explicitly: agy executes tables well and designs poorly.
- When a previous attempt exists, say what it was and what to do with it (rename + hide).
- A fix to an earlier stage: send only the delta (e.g. "recompute weights with this rule"), not the whole build.
