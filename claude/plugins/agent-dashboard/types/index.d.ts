export type Run = {
  id: string
  kind: 'subagent' | 'agy'
  label: string
  status: string
  startedAt: number
  endedAt?: number
  durationSeconds?: number
  turns?: number
  tokens?: number
  summary?: string
  cwd?: string
  pid?: number
  conversationId?: string
  /** The step it is on now: the last tool call its live log shows. */
  step?: string
  steps?: number
  errors?: number
  contextPct?: number
  timeoutSeconds?: number
  isDemo?: boolean
}

export type Board = { runs: Run[]; now: number }

/** This session as the status line and /context see it. */
export type SessionView = {
  model: string
  turns: number
  tokens?: number
  window: number
  percent?: number
  /** No reply yet: tokens and percent are /context's estimate. */
  isEstimate?: boolean
  autoCompactAt?: number
  /** The used categories of /context, largest first. */
  categories: { name: string; tokens: number; color: string }[]
  costUsd?: number
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  /** No reply yet: limits are the last reading an earlier session kept. */
  isLimitsKept?: boolean
  skillsListed?: number
  skillsTokens?: number
}

export type SkillUse = { name: string; count: number; lastAt: number }

/** One reading of the 5h window's use, `t` in epoch seconds. */
export type LimitSample = { t: number; pct: number }

/** The main loop's last finished turn. */
export type TurnStat = {
  seconds: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  tools: number
  endedAt: number
}

/** A session or agent ListAgents can reach. */
export type Peer = { name: string; section: string; type?: string; status?: string; ref?: string }

export type Peers = { list: Peer[]; at: number; error?: string }

/** An agy run this session launched, and whether its result has been checked since it ended. */
export type Review = {
  id: string
  label: string
  status: string
  cwd?: string
  endedAt: number
  state: 'pending' | 'reviewed' | 'dismissed'
  /** The model was already held at a turn's end once for this run. */
  isNudged?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-dashboard': {
      board: Board
      selected: string | null
      demoSince: number | null
      session: SessionView | null
      sessionError: string | null
      skills: SkillUse[]
      tools: Record<string, number>
      limitHistory: LimitSample[]
      lastTurn: TurnStat | null
      peers: Peers | null
      tellTarget: string | null
      isNotifyOn: boolean
      agyCalls: number[]
      reviews: Review[]
      isHintOn: boolean
      hintAt: number
      /** The run the log pane follows; null while it is closed. */
      logRun: string | null
      /** The tail of each watched run's live log, by run id. */
      logs: Record<string, string>
      /** The log pane keeps its newest line in view. */
      isFollowing: boolean
    }
  }
}
