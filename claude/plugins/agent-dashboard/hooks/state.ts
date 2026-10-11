export const PANE = 'agent-dashboard'
export const TITLE = 'Agents'
export const LOG_REL = '.claude/agent-events.jsonl'
export const RUNS_REL = '.claude/agent-runs'
export const POLL_MS = 1500
export const KEEP = 40
export const WINDOW_SECONDS = 24 * 3600
export const STALE_SECONDS = 3600
export const CONTEXT_TOKENS = 200_000
export const SESSION_POLL_MS = 5000
export const PEERS_POLL_MS = 60_000
// Context use at which the band warns, then offers to compact.
export const CTX_WARN = 70
export const CTX_COMPACT = 85
// A turn at least this long is worth a notification when it ends.
export const LONG_TURN_SECONDS = 60
// Delegate hints come at most once per this many seconds.
export const HINT_GAP_SECONDS = 10 * 60
// The pane that follows one run's live log, and how much of that log it reads.
export const LOG_PANE = 'agent-dashboard-log'
export const LOG_TAIL_BYTES = 48 * 1024
export const LOG_PANE_LINES = 400
// The open card shows this many of its run's last log lines.
export const CARD_LOG_LINES = 6
