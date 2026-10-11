---
name: orchestrator
description: Orchestrate complex, multi-stage, or parallel projects by decomposing tasks into self-contained subtasks, dispatching them to subagents / workers in parallel, streaming real-time execution in tmux panes, and strictly validating results against quality gates.
argument-hint: "[task to orchestrate] [number of workers or parallel scope]"
---

# Orchestrator: Multi-Agent Task Decomposition & Execution

As the **Orchestrator**, you govern complex workflows by breaking them down into decoupled, parallelizable subtasks, running specialized workers, and maintaining an uncompromising review gate.

## 1. The Orchestrator Protocol

```
                ┌───────────────────────────────────┐
                │        User Goal / Problem        │
                └─────────────────┬─────────────────┘
                                  ▼
                ┌───────────────────────────────────┐
                │     1. Architecture & Specs       │
                │  - Interfaces & shared contracts   │
                │  - Storyboard / test definitions  │
                │  - Immutable locks & stage setups │
                └─────────────────┬─────────────────┘
                                  ▼
                ┌───────────────────────────────────┐
                │     2. Decompose into Briefs      │
                │  - Tightly scoped, 1 task = 1 unit│
                │  - Explicit constraints & budgets │
                └─────────────────┬─────────────────┘
                                  ▼
                ┌───────────────────────────────────┐
                │     3. Dispatch Workers (tmux)    │
                │  - agy-tracked in parallel        │
                │  - Live logs in tmux / WT split   │
                └─────────────────┬─────────────────┘
                                  ▼
                ┌───────────────────────────────────┐
                │     4. Verification Gate          │
                │  - Read diffs against lock        │
                │  - Run deterministic test/SSIM    │
                │  - Follow-up if failed; approve   │
                └───────────────────────────────────┘
```

---

## 2. Running Workers with Live tmux Monitoring

Workers are executed via `agy-tracked` (`~/.local/bin/agy-tracked`). Each run automatically connects to tmux via `agent-watch`:

### Starting a Worker
```bash
agy-tracked -p "<self-contained brief>" \
  --output-format json \
  --print-timeout <timeout_seconds> \
  --dangerously-skip-permissions \
  --model <model_name>
```

### How tmux Monitoring Works
- `agent-watch` detects the terminal environment:
  1. **Inside tmux**: Splits the current window with a 45% column on the right (`tmux split-window -d -h -l 45%`). Subsequent tasks stack vertically (`tmux split-window -d -v`).
  2. **In Windows Terminal (`wt.exe`)**: Splits the current window vertically/horizontally.
  3. **Standalone / Detached**: Spawns or connects to a dedicated session called `agents` (`tmux attach -t agents`).
- Output streams in real time to `~/.gemini/antigravity-cli/agent-runs/<run_id>.log`.
- Events are captured in `~/.gemini/antigravity-cli/agent-events.jsonl`.

### Choosing Timeouts & Models
| Task Nature | Timeout | Recommended Model |
|---|---|---|
| Quick lookup, summary, 1-2 small file edits | `180s`–`300s` | `gemini-3.8-flash-medium` |
| Deep research, source verification, logic reasoning | `300s`–`600s` | `gemini-3.8-flash-high` |
| Component/Era animation, unit test writing | `600s`–`900s` | `gemini-3.8-flash-medium` |
| Heavy scene assembly, full batch compilation | `1200s`–`1800s` | `gemini-3.8-flash-medium` |

---

## 3. Parallel Dispatch Pattern

**Always maximize concurrency**: Spawn as many workers concurrently as possible (e.g. all independent animation eras, all test suites, all research parts simultaneously). Avoid sequential queuing or artificial small caps (such as 3) when subtasks are decoupled (e.g. on private stages, separate files, or isolated scopes).

```javascript
// Maximum parallel dispatch pattern (spawn all tasks simultaneously)
const limit = tasks.length; // Maximize parallel execution across all tasks
const staggerMs = 300;      // Stagger launches smoothly (300ms) for clean tmux / WT pane stacking
const workers = tasks.map(async (task, idx) => {
  if (idx > 0) await new Promise((r) => setTimeout(r, idx * staggerMs));
  return await runWorker(task);
});
const results = await Promise.all(workers);
```

---

## 4. The Verification Gate (Non-Negotiable)

When a worker completes:
1. **Never trust self-reported success**: Workers often claim "everything is done and verified" even when actions failed or were omitted.
2. **Inspect the Diff**:
   ```bash
   diff -u path/to/locked_reference path/to/worker_output
   # or
   git diff path/to/file
   ```
3. **Run Automated Test/Gate**:
   - For code: Run linter, build, and test suite.
   - For animations: Run `check.mjs` verifying rules (no globals, no `Math.random()`), build validity, and panel SSIM ≥ 0.97.
   - For Blender: Inspect camera view with `scripts/blender_mcp_call.py look` and render preview contact sheets.
4. **Follow-ups over Manual Rewrites**:
   If a worker made a minor mistake or misinterpreted an instruction, do not silently fix it yourself. Re-prompt with the exact error details:
   ```bash
   agy-tracked -p "The build failed with error: <error>. Fix this in <file> and run <test>." \
     --conversation <conversation_id> \
     --output-format json \
     --dangerously-skip-permissions
   ```
