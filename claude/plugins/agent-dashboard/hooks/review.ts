import type { Review, Run } from '../types'

// A shell command that checks work: reads the diff, or runs tests, a build or a linter.
const REVIEW_COMMAND = new RegExp(
  [
    String.raw`\bgit\s+(?:-C\s+\S+\s+)?(?:diff|show|status|log\s+(?:-p|--patch|--stat))\b`,
    String.raw`\b(?:pytest|tsc|mypy|ruff|eslint|jest|vitest|unittest)\b`,
    String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck)\b`,
    String.raw`\bcargo\s+(?:test|check|build|clippy)\b`,
    String.raw`\bgo\s+(?:test|vet|build)\b`,
    String.raw`\bmake\b`,
    String.raw`\bclaude\s+plugin\s+(?:test|validate)\b`,
  ].join('|'),
)

export const isAgyLaunch = (command: string) => /\bagy-tracked\b/.test(command)

export const isReviewCommand = (command: string) => !isAgyLaunch(command) && REVIEW_COMMAND.test(command)

// A run is this session's when it started just after one of its agy-tracked calls.
export function isMine(run: Pick<Run, 'startedAt'>, calls: readonly number[]): boolean {
  return calls.some(t => run.startedAt >= t - 2 && run.startedAt <= t + 30)
}

// Adds each of this session's agy runs as it ends, pending until something checks it.
export function syncReviews(old: readonly Review[], runs: readonly Run[], calls: readonly number[]): Review[] {
  const known = new Set(old.map(one => one.id))
  const added = runs
    .filter(run => run.kind === 'agy' && run.isDemo !== true && run.status !== 'running' && run.status !== 'stale')
    .filter(run => !known.has(run.id) && isMine(run, calls))
    .map(
      (run): Review => ({
        id: run.id,
        label: run.label,
        status: run.status,
        cwd: run.cwd,
        endedAt: run.endedAt ?? run.startedAt,
        state: 'pending',
      }),
    )
  return added.length === 0 ? [...old] : [...added, ...old].slice(0, 40)
}

// What a main-loop tool call checks: the pending runs it counts as a review of.
// A review command checks them all; reading a file checks those whose folder holds it.
export function reviewedBy(tool: string, input: Record<string, unknown>, pending: readonly Review[], now: number): string[] {
  const ended = pending.filter(one => one.endedAt <= now + 1)
  if (tool === 'Bash') return typeof input.command === 'string' && isReviewCommand(input.command) ? ended.map(one => one.id) : []
  if (!['Read', 'Grep', 'Glob'].includes(tool)) return []
  const path = [input.file_path, input.path].find((value): value is string => typeof value === 'string' && value !== '')
  return ended
    .filter(one => one.cwd === undefined || path === undefined || path.startsWith(one.cwd) || !path.startsWith('/'))
    .map(one => one.id)
}

export function mark(list: readonly Review[], ids: readonly string[], state: Review['state']): Review[] {
  return ids.length === 0 ? [...list] : list.map(one => (ids.includes(one.id) && one.state === 'pending' ? { ...one, state } : one))
}

export const pendingOf = (list: readonly Review[]) => list.filter(one => one.state === 'pending')

export const REVIEW_NOTE = [
  'agent-dashboard review gate: đây là việc của agy.',
  'Trước khi báo lại cho người dùng: đọc thay đổi thật (git diff hoặc chính các file), chạy test/build/lint liên quan nếu có,',
  'kiểm tra status là SUCCESS, không có denied_actions và response không rỗng.',
  'Khi báo lại, nói rõ việc do agy làm và bạn đã kiểm tra những gì.',
].join(' ')

// Why the turn may not end yet: the runs whose result nobody has looked at.
export function holdReason(list: readonly Review[]): string {
  const lines = list.map(one => `- ${one.id} (${one.status}): ${one.label.slice(0, 100)}`)
  return [
    `Còn ${list.length} lần chạy agy chưa được review:`,
    ...lines,
    'Đọc thay đổi (git diff hoặc file), chạy test nếu có, kiểm tra status/denied_actions, rồi mới báo lại.',
    'Nếu đã kiểm tra bằng cách khác hoặc run thất bại không để lại thay đổi, nói rõ điều đó trong câu trả lời.',
  ].join('\n')
}
