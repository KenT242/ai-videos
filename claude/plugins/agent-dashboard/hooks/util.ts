import type { LimitSample, TurnStat } from '../types'
import { forecast, resetAtSeconds } from './extras'

export type LogEvent = Record<string, unknown> & { id?: string; event?: string; ts?: number }

export function short(value: unknown, n = 160): string {
  const text = (typeof value === 'string' ? value : JSON.stringify(value) ?? '').replace(/\s+/g, ' ')
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`
}

export const num = (value: unknown) => (typeof value === 'number' ? value : undefined)
export const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

// Time left until a rate-limit window resets: `1h12m`, `—` when unknown.
export function resetIn(resetsAt: string | number | undefined, now: number): string {
  // ISO 8601 as typed; epoch seconds or milliseconds tolerated.
  const raw = typeof resetsAt === 'string' && /^\d+(\.\d+)?$/.test(resetsAt) ? Number(resetsAt) : resetsAt
  const at =
    raw === undefined ? NaN : typeof raw === 'number' ? (raw > 1e12 ? raw / 1000 : raw) : Date.parse(raw) / 1000
  if (Number.isNaN(at)) return '—'
  const left = at - now
  if (left <= 0) return 'sắp reset'
  const minutes = Math.ceil(left / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// A short span: `1h20m`, `45m`, `<1m`.
export function span(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  if (minutes < 1) return '<1m'
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// The 5h window's outlook in words and a colour.
export function outlook(history: readonly LimitSample[], now: number, resetsAt: string | undefined) {
  const f = forecast(history, now, resetAtSeconds(resetsAt))
  if (f.kind === 'measuring') return { text: 'đang đo', color: 'subtle' }
  if (f.kind === 'steady') return { text: 'ổn định', color: 'success' }
  const rate = `+${f.perHour.toFixed(f.perHour < 10 ? 1 : 0)}%/h`
  return f.isBeforeReset
    ? { text: `${rate} · hết sau ~${span(f.secondsToFull)}`, color: f.secondsToFull < 1800 ? 'error' : 'warning' }
    : { text: `${rate} · đủ tới reset`, color: 'success' }
}

export function turnLine(stat: TurnStat): string {
  return [
    clock(stat.seconds),
    stat.inputTokens !== undefined ? `${compact(stat.inputTokens)} in` : '',
    stat.outputTokens !== undefined ? `${compact(stat.outputTokens)} out` : '',
    stat.costUsd !== undefined ? `$${stat.costUsd.toFixed(2)}` : '',
    `${stat.tools} tool`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export const limitName = (kind: string) => kind.replace('five_hour', '5h').replace('seven_day', '7d')

export function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export type Look = { icon: string; color: string; word: string }
const LOOK: Record<string, Look> = {
  running: { icon: '●', color: 'warning', word: 'đang chạy' },
  SUCCESS: { icon: '✓', color: 'success', word: 'xong' },
  done: { icon: '✓', color: 'success', word: 'xong' },
  stale: { icon: '?', color: 'subtle', word: 'mất tín hiệu' },
  EMPTY: { icon: '✗', color: 'error', word: 'rỗng / timeout' },
  DENIED: { icon: '⊘', color: 'error', word: 'bị từ chối' },
  KILLED: { icon: '■', color: 'subtle', word: 'đã dừng' },
}
export const lookOf = (status: string): Look => LOOK[status] ?? { icon: '✗', color: 'error', word: status }
export const isFailed = (status: string) => !['running', 'SUCCESS', 'done', 'stale'].includes(status)

// Share of the way to a limit, as a color: calm, then warning, then error.
export const heat = (pct: number) => (pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success')

export function bar(pct: number, cells = 10): [string, string] {
  const full = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  return ['█'.repeat(full), '░'.repeat(cells - full)]
}
