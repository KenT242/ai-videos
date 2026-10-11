---
name: animate-director
description: Run the `animate` skill as Orchestrator with agy workers researching the facts and animating the eras in parallel. Worker researches the on-screen claims and returns a sourced JSON report that Orchestrator verifies; Orchestrator owns intake, story, look, storyboard, the shared files (head, bridges, score), the lock and the review; agy worker only adds motion to one approved era file at a time, checked automatically against the locked storyboard. Use when the user wants an animate piece built with agy, eras animated in parallel, or the Orchestrator-directs / worker-builds split for a procedural animation.
argument-hint: "[what the video is about] [style or reference]"
---

# Animate director: Orchestrator directs, agy workers animate the eras

This skill runs on top of the **animate** skill (`~/.gemini/config/skills/animate`, or `$ANIMATE_SKILL`). Read its SKILL.md first and follow its flow, non-negotiables and check-ins. This skill changes one thing: **who writes the motion**. Scripts live in `scripts/` here; run them with `node <this skill>/scripts/<name>.mjs`.

**Requirements** (beyond animate's): agy at `~/.local/bin/agy-tracked`; an ffmpeg with `drawtext` (review.mjs's contact sheets; the johnvansickle static build lacks it, BtbN's has it); Chromium's system libs (`libnss3 libnspr4 libasound2t64`). Check with `ffmpeg -filters | grep drawtext` and `ldd ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-*/chrome-headless-shell | grep 'not found'`.

## Roles

| | Orchestrator (director) | agy worker (one per era) |
|---|---|---|
| Intake, story check | ✔ | |
| Research: the claim list, then verifying and choosing what goes on screen | ✔ | |
| Research: finding the facts and sources, summarised as JSON (`templates/research.md`) | | ✔ (parallel workers via `scripts/research.mjs`) |
| Look check (2–4 style frames) | ✔ | |
| Storyboard: every era's key frame(s) as code, `TIMELINE.board` | ✔ | |
| Shared files: `src/head.html`, `src/common.js`, `src/bridges.js`, `src/score.js`, `piece.json`, kit/style changes | ✔ | read only |
| Motion table per era (`director/eras.json`) | ✔ decides every beat | |
| Animating one era file to that table | | ✔ |
| Lock, run, checks, tiles across boundaries, export, `review.mjs`, delivery | ✔ | |

The key frame *is* the scene function (animate renders storyboard panels with the video's own code), so agy never invents the look: it makes an approved frame move, on a timetable you wrote. That makes its task small and checkable.

**If an era fails, don't write its motion yourself.** Read the check JSON and agy's transcript, then send a follow-up (`run.mjs --followup`) or fix `eras.json` and rerun that era. Small diagnostic edits while reviewing are fine; say so. If an era fails twice in a row, stop and tell the user (show the tile and SSIM numbers) rather than polishing.

## Piece layout (set this up at the storyboard step)

```
pieces/<name>/
  piece.json            "scenes": ["src/common.js", "src/era-01.js", "src/era-02.js", ...]
  src/head.html         ERA_LIST = [[0, 4, () => e01()], [4, 8, () => e02()], ...], TIMELINE (cues, board, acts)
  src/common.js         shared helpers (wall(), props used by several eras): director-owned
  src/era-NN.js         function eNN() { ... } + helpers prefixed eNN: the approved key frame, later agy's file
  src/bridges.js, src/score.js
  director/eras.json    the eras' timing, panels, cues, bridges and motion tables (templates/eras.json)
```

Rules for the era files you write at storyboard time:
- One era per file, scene function named after its prefix (`e03`), every top-level name prefixed (`e03Lamp`). Shared props go in `src/common.js`, never in an era file.
- Draw the key frame **finished at its panel time**, using `TT` conditions only where the frame needs them. Leave the motion to agy, but don't leave it unspecified: every beat goes in the motion table.
- Panel times should sit where the frame is settled (not mid-move), or the SSIM check will fight the motion.

## The flow

0–2. **Intake, story, look:** as in animate's SKILL.md (AskUserQuestion with a recommended default; gallery; style frames). The one change is that **agy does the research**:
   1. **Claims (you):** after intake, draft the beats and list every on-screen claim to check (dates, names, numbers, "first", quotes), plus the open questions (e.g. "a short, true number for ChatGPT's early growth").
   2. **Research (agy):** fill `templates/research.md` into `director/research/brief.md`. Run it with `node scripts/research.mjs pieces/<name>` (Bash `run_in_background: true`). It automatically partitions claims into parallel chunks and spawns concurrent agy workers with `--model gemini-3.8-flash-high` and `--json-schema templates/research.schema.json`. Live logs stream to tmux/WT panes via `agent-watch`. When all finish, it automatically merges into `director/research/report.json` and runs `research-check.mjs` (~60–90 s total, instead of several minutes sequentially). While it runs, keep going with the story and the look.
   3. **Verify (you):** agy's report is evidence, not proof. First run `node scripts/research-check.mjs pieces/<name>`, which fetches every cited URL. Dead links and links that bounce to a homepage fail the item (agy invents plausible URLs). Re-research a failed item yourself or with a follow-up. Sources behind bot walls show as `unchecked`; confirm those with your own search. Re-check any claim it marks `weak`/`conflicting` or that relies on a single source with your own search. Spot-check at least one `strong` claim. Check that the sources are primary or reputable, and fix the wording to match what the sources actually say ("1 million sign-ups", not "users"). If a run has an empty `response`, a non-SUCCESS `status` or `denied_actions`, it has failed: follow up with `--conversation <id>`, or do that research yourself and say so.
   4. Put the checked claims and their sources in `brief.md` and show them at the story check. Say that agy did the research and which claims you re-checked.

3. **Storyboard (you):** write `head.html`, `common.js`, one `era-NN.js` per beat/era with its key frame, `bridges.js`, `TIMELINE.board`. Render the board, get thumbs up by panel number, redraw what's down.

4. **Motion tables (you):** copy `templates/eras.json` to `director/eras.json` and fill one entry per era:
   - `t0`, `t1`, `panels` (the approved board times inside the era), `cues` (absolute seconds), `bridgeIn` / `bridgeOut` (what must be in frame at the boundary, with coordinates),
   - `motion`: rows `[t, "what happens, with the kit call and numbers"]`, every number decided. agy implements the table and nothing else, so a vague row gets a vague result.
   - `life` (idle motion), `notes`; optionally a per-era `model`.
   - Top level: `model` (default `gemini-3.8-flash-medium`; the table holds the decisions, so a fast model is enough), `parallel` (default `"max"`: runs all eras simultaneously in parallel without artificial throttling; or pass `--parallel N`), `timeout` (default 900s; also per era. Choose it per the agy skill's "Choosing the timeout": ~10 s per tool call + the check runs (~5–15 s each) + 50 %, more for big eras), `ssimMin` (0.97: renders are deterministic, so an untouched panel scores 1.0; a changed caption drops to ~0.97).

5. **Lock:** `node scripts/lock.mjs pieces/<name>`. This builds the piece, renders every approved panel to `director/approved/`, snapshots `src/` and hashes every file the build reads. Re-lock after any change you make to shared files or panels; never lock over an agy change you haven't reviewed.

6. **Run agy (in the background):** `node scripts/run.mjs pieces/<name> [n ...] [--parallel <N|max>]` with Bash `run_in_background: true`. By default, it spawns **all eras concurrently in parallel** (maximum concurrency) with a smooth ~300ms pane stagger, regenerating `director/briefs/eNN.md` from eras.json and checking each era as it finishes. Live logs stream into tmux / WT panes via `agent-watch` (watch `~/.gemini/antigravity-cli/agent-runs/*.log`). Stop a drifting run and follow up instead of waiting for the timeout.
   - `check.mjs` builds each era on a **private stage** (`director/stage/eNN`: the locked `src/` plus only that era's live file), so parallel eras never break each other's build. It checks:
     - ownership: nothing else changed;
     - rules: no `Math.random`/`Date`/timers/URLs, and every top-level name is prefixed;
     - build;
     - panels: SSIM against the approved PNGs;
     - tile: 12 frames with no page errors and deterministic output.
   - Follow-up: `node scripts/run.mjs pieces/<name> --followup <n> "<what to fix>"`.

7. **Review (you):** for every era:
   - Read the diff against the lock: `diff -u director/lock/src/era-NN.js src/era-NN.js`.
   - Read `director/checks/eNN.json`, then **look** at `director/stage/eNN/tile.png` and the panel PNGs. agy's own verdicts are not proof.
   - Check that `runs/eNN.json` has `status` SUCCESS, a non-empty `response` and no `denied_actions`.

   Then assemble and run the full animate review:
   - `node <animate>/tools/build.mjs pieces/<name>`.
   - Tile across **every boundary** (bridges are where separately written eras meet).
   - Score, `export.mjs --share`, then `review.mjs`.
   - Write the per-shot PASS table in `LOG.md`, noting which eras agy animated and how many rounds each took.

8. **Deliver and learn:** as in animate. When a brief rule or an eras.json habit fixed something, add one line to this file's *Lessons* section.

## Files

| path | what |
|---|---|
| `scripts/lock.mjs <piece>` | build, render approved panels, snapshot and hash the piece |
| `scripts/brief.mjs <piece> [n...]` | write agy's self-contained brief per era (run.mjs calls it) |
| `scripts/run.mjs <piece> [n...]` / `--followup n "msg"` | parallel agy runs + checks (spawns all eras simultaneously by default); results in `director/runs/`, `director/checks/` |
| `scripts/check.mjs <piece> <n>` | the per-era gate (agy runs it too); exit 0 = PASS |
| `templates/eras.json` | an annotated example entry (`"parallel": "max"`) |
| `scripts/research.mjs <piece>` | spawn parallel agy research workers partitioned across claims/questions, merge into report.json |
| `scripts/research-check.mjs <piece>` | fetch every source URL in `director/research/report.json`; exit 1 on dead or homepage-bounce links |
| `templates/research.md` | agy's research brief (fill in the topic, the claims and the questions) |
| `templates/research.schema.json` | the JSON shape of the research report (`--json-schema`) |

## Lessons
- 2026-10-10, first test (2-era starter, flash-medium, parallel): both eras PASS in one round, 108 s and 217 s, panel SSIM 0.999; full review PASS. Motion rows written as exact kit calls were implemented verbatim: keep writing them that way.
- 2026-10-10: a changed caption only drops panel SSIM to ~0.97 at scale 0.5, so 0.9 was too lax; idle life (a flicker) costs ~0.001.
- Low-alpha warm light on a dark wall reads grey, not glowing: spec glows with a brighter alpha or `globalCompositeOperation = 'lighter'`.
- 2026-10-10, parallel research: partitioned claims running across concurrent workers with `scripts/research.mjs` finish in ~60-90s vs 285s sequentially, with better verification focus per claim. URL verification via `research-check.mjs` remains mandatory.
- 2026-10-10, maximal parallel execution: always spawn all eras simultaneously (e.g. all 10-15 eras concurrently) rather than small sequential batches. Each era runs on its private stage (`director/stage/eNN/`) with zero build contention. All eras finish in a single wave in ~100-200s total, eliminating sequential waits.
- Never edit a locked shared file (score.js, bridges.js, head) while eras are running: every era's ownership check fails and agy may try to "fix" it. Write the score to `director/score.next.js`, then swap it in and re-lock after the runs.
- Rush close-ups: screen-space tags (rushTag) don't zoom with the camera, so a 1.6× cut-in pushed the world's top row under the year tag. Tile the close shots at storyboard time and keep a cut-in ≤ ~1.35× when the world has content near y 600.
