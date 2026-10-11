import type { LimitSample, Peer } from '../types'

const SPARKS = '▁▂▃▄▅▆▇█'
// How far back the burn rate looks, and the least span it needs to say anything.
const RATE_WINDOW_SECONDS = 90 * 60
const RATE_MIN_SPAN_SECONDS = 5 * 60

// Adds a reading of the 5h window's use; a drop means the window reset, so history starts over.
export function addSample(history: readonly LimitSample[], sample: LimitSample, keep = 120): LimitSample[] {
  const last = history[history.length - 1]
  if (last !== undefined && sample.pct < last.pct - 1) return [sample]
  if (last !== undefined && last.pct === sample.pct && sample.t - last.t < 300) return [...history]
  return [...history, sample].slice(-keep)
}

export type Forecast =
  | { kind: 'measuring' }
  | { kind: 'steady' }
  | { kind: 'rate'; perHour: number; secondsToFull: number; isBeforeReset: boolean }

// Where the 5h window is heading: how fast it fills, and whether it fills before it resets.
export function forecast(history: readonly LimitSample[], now: number, resetAt: number | undefined): Forecast {
  const recent = history.filter(one => now - one.t <= RATE_WINDOW_SECONDS)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (first === undefined || last === undefined || last.t - first.t < RATE_MIN_SPAN_SECONDS) return { kind: 'measuring' }
  const rise = last.pct - first.pct
  if (rise <= 0) return { kind: 'steady' }
  const perSecond = rise / (last.t - first.t)
  const secondsToFull = Math.max(0, (100 - last.pct) / perSecond)
  const isBeforeReset = resetAt === undefined ? true : now + secondsToFull < resetAt
  return { kind: 'rate', perHour: perSecond * 3600, secondsToFull, isBeforeReset }
}

export function sparkline(history: readonly LimitSample[], cells = 8): string {
  return history
    .slice(-cells)
    .map(one => SPARKS[Math.max(0, Math.min(SPARKS.length - 1, Math.floor((one.pct / 100) * SPARKS.length)))])
    .join('')
}

export function resetAtSeconds(resetsAt: string | number | undefined): number | undefined {
  const raw = typeof resetsAt === 'string' && /^\d+(\.\d+)?$/.test(resetsAt) ? Number(resetsAt) : resetsAt
  const at =
    raw === undefined ? NaN : typeof raw === 'number' ? (raw > 1e12 ? raw / 1000 : raw) : Date.parse(raw) / 1000
  return Number.isNaN(at) ? undefined : at
}

type ListAgentsResult = {
  sections?: { kind: string; rows: { name?: string; ref?: string; id?: string; type?: string; status?: string }[] }[]
}

// The reachable sessions and agents, as ListAgents lists them.
export function toPeers(result: unknown): Peer[] {
  const sections = (result as ListAgentsResult | undefined)?.sections ?? []
  return sections.flatMap(section =>
    section.rows
      .filter(row => typeof row.name === 'string' && row.name !== '')
      .map(row => ({
        name: row.name as string,
        section: section.kind,
        type: row.type,
        status: row.status,
        ref: row.ref,
      })),
  )
}

// Those a broadcast goes to: the other sessions, not this session's own subagents.
export const isSession = (peer: Peer) => /session|peer|remote|cloud/i.test(`${peer.section} ${peer.type ?? ''}`)

// `/tell name message` → its two parts; a quoted name may hold spaces.
export function parseTell(args: string): { to: string; text: string } | undefined {
  const match = args.trim().match(/^(?:"([^"]+)"|(\S+))\s+([\s\S]+)$/)
  if (match === null) return undefined
  return { to: (match[1] ?? match[2] ?? '').trim(), text: (match[3] ?? '').trim() }
}

export function delegatePrompt(task: string): string {
  return [
    'Giao việc sau cho agy (dùng skill `agy`, chạy qua `agy-tracked` để hiện trong bảng Agents):',
    '',
    `> ${task.replace(/\n/g, '\n> ')}`,
    '',
    'Cách làm:',
    '1. Viết brief tự đủ ngữ cảnh cho agy: thư mục, các file liên quan, mục tiêu, ràng buộc, kết quả mong đợi.',
    '2. Chạy nền (run_in_background) với --print-timeout phù hợp.',
    '3. Khi xong: đọc thay đổi thật (git diff / file), chạy test nếu có, kiểm tra status và denied_actions.',
    '4. Báo lại ngắn gọn: agy đã làm gì, bạn đã kiểm tra gì.',
    'Nếu việc này không hợp để giao (nhiều file, cần quyết định thiết kế, rủi ro), nói rõ và hỏi tôi trước.',
  ].join('\n')
}
