import type { Register } from 'claude-code'

import { judge } from './rules'

export const register: Register = on => {
  // PreToolUse is where an ask can still reach the person; tool.call alone can only refuse.
  on('classic.PreToolUse', async ($, e, next) => {
    const verdict = judge(e.tool, e as unknown as Record<string, unknown>)
    if (verdict === undefined) return next(e)
    if ('deny' in verdict) {
      $.ui.toast(`⊘ agent-guard chặn ${e.tool}: ${verdict.deny}`)
      return { deny: `agent-guard: ${verdict.deny}` }
    }
    const below = await next(e)
    // A deny beneath stands; an ask or allow beneath still yields to the guard's ask.
    return 'deny' in below && below.deny !== undefined ? below : { ask: `agent-guard: ${verdict.ask}` }
  }).catch(($, e, next) => (next.called ? next(e) : { ask: 'agent-guard: kiểm tra bị lỗi, hỏi lại cho chắc' }))
}
