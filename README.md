# ai-videos

Mods, skills and config for Claude Code and Gemini (Antigravity CLI), used for procedural animation and Blender work.

## Layout

- `claude/plugins/` — Claude Code plugin marketplace `kent-mods`: `agent-dashboard`, `agent-guard`
- `claude/skills/` — Claude Code user skills: `agy`, `animate`, `animate-director`, `blender`
- `claude/CLAUDE.md`, `claude/settings.json` — global Claude Code instructions and settings
- `gemini/skills/` — Antigravity skills: `animate`, `animate-director`, `blender`, `orchestrator`
- `gemini/GEMINI.md`, `gemini/mcp_config.json`, `gemini/skills.json` — Antigravity config
- `bin/` — helper scripts: `agy-tracked`, `agent-event`, `agent-tail`, `agent-watch`

Not included: Anthropic-provided skills (docx, pdf, pptx, xlsx, skill-creator, …) whose license forbids copying them, Antigravity built-in skills, credentials, history and logs.

## Install

```sh
cp -r claude/skills/* ~/.claude/skills/
cp -r gemini/skills/* ~/.gemini/config/skills/
cp bin/* ~/.local/bin/
claude plugin marketplace add ./claude/plugins   # then enable agent-dashboard / agent-guard
```
