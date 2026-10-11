---
name: agy
description: Delegate a task to Antigravity CLI (agy) and get its result back, then review it. Use by default for small, well-scoped, low-risk tasks (see ~/.claude/CLAUDE.md), and when the user asks to give a task to agy/Antigravity, get a second opinion from it, or run work in parallel through it.
---

# Delegating to agy (Antigravity CLI)

agy is installed at `~/.local/bin/agy`. Always call it through `agy-tracked` (same args, same output), which logs each run's start/end to `~/.claude/agent-events.jsonl` so the agent-tracker pane can show progress. Run it non-interactively in print mode and read the JSON result.

## New task

```bash
cd <project dir> && agy-tracked -p "<task, with full context: files, goal, constraints, expected output>" \
  --output-format json --print-timeout <T> --dangerously-skip-permissions
```

Result is one JSON line:
`{"conversation_id": "...", "status": "SUCCESS", "response": "...", "duration_seconds": ..., "num_turns": ..., "usage": {...}}`

- Read `response` for the answer; check that `status` is `SUCCESS`.
- Keep `conversation_id` if a follow-up may be needed.

## Choosing the timeout `<T>`

There is no fixed limit: pick `--print-timeout` per task from its expected size, and say the number in the brief ("you have about N minutes"). Estimate it as **tool calls × ~10 s + the slow commands it must run (builds, renders, tests) + ~50 % margin**:

| task | typical `<T>` |
|---|---|
| lookup, summary, one small edit | `180s`–`300s` |
| one file / function with a check run (e.g. one animate era) | `600s`–`900s` |
| several files, a build or test suite, renders | `1200s`–`1800s` |
| long multi-step work (big scene, many renders) | `2400s`–`3600s`; or `0` (no limit), only when watched in the background |

- A long timeout is not a licence for a loose brief: keep the tool-call budget and priorities either way. If a run would need more than ~30 min, split the task instead.
- Run anything above ~1 min with Bash `run_in_background: true`, and give the Bash call a timeout above `<T>` (Bash max 600000 ms in the foreground, so long runs must be background).
- If a run hits the timeout with work half done, read the transcript to see where the time went before raising `<T>`: usually the brief needs fixing, not the clock.
- Record a task type's real duration (`duration_seconds`) in the domain skill's notes so later estimates improve.

## Follow-up in the same conversation

```bash
agy-tracked -p "<follow-up>" --conversation <conversation_id> --output-format json --dangerously-skip-permissions
```

## Useful flags

- `--mode plan`: plan only, no edits. `--mode accept-edits`: auto-accept file edits.
- `--dangerously-skip-permissions`: auto-approve every tool call. The user (2026-10-10) said to always pass it by default.
- `--model <name>` (list with `agy models`), `--effort low|medium|high|xhigh|max`
- `--add-dir <dir>`: give agy access to more directories.
- `--json-schema '<schema or path>'`: force structured output.

## Speed: turns are the cost

Each agy tool call costs ~8–12 s of model time; the tools themselves are usually instant. A brief that lets agy explore, screenshot and "improve" things runs out the clock (when the print timeout hits → `status: SUCCESS` with an **empty `response`**, work half done). In the brief:
- Hand over the facts and APIs it would otherwise probe for.
- Set a tool-call budget and ask for few, large steps (one script, one check).
- List requirements in priority order, core deliverable first.
- Forbid side quests explicitly (no screenshots/visual polish, no unrequested changes; report problems instead of chasing them).
- When the brief already holds the decisions, pick a lower-thinking model (`--model gemini-3.8-flash-medium`): on a Blender task `flash-high` spent 158 s thinking before one script, `flash-medium` did the same job in 58 s total.

## Watching a run

`agy-tracked` writes a readable live log to `~/.claude/agent-runs/<id>.log`. For runs longer than a minute, start it with `run_in_background: true` and check the log; if agy drifts off-brief, stop it (TaskStop) and send a corrected follow-up rather than waiting for the timeout. After any failure, read the full transcript at `~/.gemini/antigravity-cli/brain/<conversation_id>/.system_generated/logs/transcript_full.jsonl` (one JSON row per step, with `created_at` timestamps) to see where the time went.

## Domain notes

- **Blender (Blender MCP):** use the `blender` skill (`~/.claude/skills/blender/`): brief template, verified Blender 5.2 APIs, review scripts and quality checks.

## Notes

- agy starts with no context, so write self-contained prompts.
- For long tasks, use Bash `run_in_background: true` with a Bash timeout above the expected duration.
- Since agy auto-approves everything, run it in the right project directory and give it a tightly scoped task.
- Check agy's file changes yourself (e.g. `git diff`) before you tell the user the task is done.
