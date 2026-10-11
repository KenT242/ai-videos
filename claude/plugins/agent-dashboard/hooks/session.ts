import type { SessionUsage } from 'claude-code'

import type { SessionView } from '../types'

export function toSessionView(usage: SessionUsage, model: string, turns: number): SessionView {
  const { context } = usage
  const breakdown = context.breakdown
  return {
    model: breakdown?.model ?? model,
    turns,
    // Before the first reply the status line has no figures: /context's estimate stands in.
    tokens: context.tokens ?? breakdown?.totalTokens,
    window: context.window,
    percent: context.percent ?? (breakdown === undefined ? undefined : Math.round(breakdown.percentage)),
    isEstimate: context.percent === undefined && breakdown !== undefined ? true : undefined,
    autoCompactAt: breakdown?.autoCompactThreshold,
    categories: (breakdown?.categories ?? [])
      .filter(row => row.kind === 'used' && row.tokens > 0)
      .map(row => ({ name: row.name, tokens: row.tokens, color: row.color }))
      .sort((a, b) => b.tokens - a.tokens),
    costUsd: usage.cost?.usd,
    limits: usage.rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt })),
    skillsListed: breakdown?.skills?.includedSkills,
    skillsTokens: breakdown?.skills?.tokens,
  }
}
