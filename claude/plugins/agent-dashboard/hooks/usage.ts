import { compact } from './util'

// One day's work: the main loop's turns, and the agy and subagent runs that ended that day.
export type DayUsage = {
  day: string
  turns: number
  turnSeconds: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  tools: number
  agyRuns: number
  agyFailed: number
  agyTokens: number
  agySeconds: number
  subagents: number
}

const empty = (day: string): DayUsage => ({
  day, turns: 0, turnSeconds: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, tools: 0,
  agyRuns: 0, agyFailed: 0, agyTokens: 0, agySeconds: 0, subagents: 0,
})

const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// A day as the person's clock reads it, YYYY-MM-DD.
export function dayOf(ts: number, offsetMinutes: number): string {
  return new Date((ts + offsetMinutes * 60) * 1000).toISOString().slice(0, 10)
}

function agyTokens(usage: unknown): number {
  if (usage === null || typeof usage !== 'object') return 0
  const u = usage as Record<string, unknown>
  return typeof u.total_tokens === 'number' ? u.total_tokens : n(u.input_tokens) + n(u.output_tokens)
}

// Folds the event log into one row per day for the last `days` days, oldest first.
export function summarize(text: string, now: number, days: number, offsetMinutes = 0): DayUsage[] {
  const since = now - days * 86_400
  const rows = new Map<string, DayUsage>()
  const row = (ts: number) => {
    const day = dayOf(ts, offsetMinutes)
    const found = rows.get(day) ?? empty(day)
    rows.set(day, found)
    return found
  }
  const kinds = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const ts = n(ev.ts)
    if (typeof ev.id === 'string' && ev.event === 'start') kinds.set(ev.id, String(ev.kind ?? 'subagent'))
    if (ts < since) continue
    if (ev.kind === 'claude' && ev.event === 'turn') {
      const day = row(ts)
      day.turns += 1
      day.turnSeconds += n(ev.seconds)
      day.inputTokens += n(ev.input_tokens)
      day.outputTokens += n(ev.output_tokens)
      day.costUsd += n(ev.cost_usd)
      day.tools += n(ev.tools)
    } else if (typeof ev.id === 'string' && ev.event === 'end') {
      const kind = String(ev.kind ?? kinds.get(ev.id) ?? 'subagent')
      const day = row(ts)
      if (kind === 'agy') {
        day.agyRuns += 1
        if (ev.status !== 'SUCCESS') day.agyFailed += 1
        day.agyTokens += agyTokens(ev.usage)
        day.agySeconds += n(ev.duration_seconds)
      } else {
        day.subagents += 1
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day))
}

const minutes = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)}m`)

// The report as a Markdown table, totals last.
export function report(rows: readonly DayUsage[], days: number): string {
  if (rows.length === 0) return `Không có dữ liệu trong ${days} ngày qua (số liệu lượt Claude chỉ được ghi từ bản này trở đi).`
  const total = rows.reduce(
    (sum, one) => {
      for (const key of Object.keys(sum) as (keyof DayUsage)[]) {
        if (key !== 'day') (sum[key] as number) += one[key] as number
      }
      return sum
    },
    empty('Tổng'),
  )
  const line = (one: DayUsage) =>
    `| ${one.day} | ${one.turns} | ${minutes(one.turnSeconds)} | ${compact(one.inputTokens)}/${compact(one.outputTokens)} | $${one.costUsd.toFixed(2)} | ${one.tools} | ${one.agyRuns}${one.agyFailed > 0 ? ` (${one.agyFailed} lỗi)` : ''} | ${compact(one.agyTokens)} | ${minutes(one.agySeconds)} | ${one.subagents} |`
  const shareOfRuns = total.agyRuns + total.turns === 0 ? 0 : Math.round((total.agyRuns / (total.agyRuns + total.turns)) * 100)
  return [
    `**Usage ${days} ngày qua**`,
    '',
    '| Ngày | Lượt Claude | Thời gian | Token in/out | Chi phí | Tool | agy | Token agy | Thời gian agy | Subagent |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(line),
    line(total).replace(/^\| Tổng/, '| **Tổng**'),
    '',
    `agy chiếm ${shareOfRuns}% số việc (agy / (agy + lượt Claude)); tỉ lệ agy lỗi ${total.agyRuns === 0 ? 0 : Math.round((total.agyFailed / total.agyRuns) * 100)}%.`,
  ].join('\n')
}
