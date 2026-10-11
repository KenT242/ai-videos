import type { Run } from '../types'
import { CONTEXT_TOKENS, KEEP, STALE_SECONDS, WINDOW_SECONDS } from './state'
import { num, short, str } from './util'
import type { LogEvent } from './util'

function sumTokens(usage: unknown): number | undefined {
  if (usage === null || typeof usage !== 'object') return undefined
  const given = (usage as Record<string, unknown>).total_tokens
  if (typeof given === 'number') return given
  let total = 0
  for (const [key, value] of Object.entries(usage as Record<string, unknown>)) {
    if (typeof value === 'number' && /token/i.test(key) && !/cache/i.test(key)) total += value
  }
  return total || undefined
}

// One subagent transcript row as readable lines for its live log.
export function describeRow(content: readonly unknown[]): string {
  const lines: string[] = []
  for (const raw of content) {
    const block = raw as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      lines.push(block.text.trim())
    } else if (block.type === 'tool_use') {
      lines.push(`▸ ${String(block.name)} ${short(block.input)}`)
    } else if (block.type === 'tool_result') {
      const body = Array.isArray(block.content)
        ? (block.content as Record<string, unknown>[]).map(part => part.text ?? '').join(' ')
        : block.content
      lines.push(`  ${block.is_error === true ? '✗' : '↳'} ${short(body, 120)}`)
    }
  }
  return lines.join('\n')
}

// Folds the event log into one Run per id, newest first. A `progress` event
// (tokens, context, step) updates a running run when the wrapper sends one.
export function fold(text: string, now: number): Run[] {
  const runs = new Map<string, Run>()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let ev: LogEvent
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof ev.id !== 'string' || typeof ev.ts !== 'number') continue
    const kind = ev.kind === 'agy' ? 'agy' : 'subagent'
    if (ev.event === 'start') {
      runs.set(ev.id, {
        id: ev.id,
        kind,
        label: String(ev.task || ev.description || ev.agent_type || ev.id),
        status: 'running',
        startedAt: ev.ts,
        cwd: str(ev.cwd),
        pid: num(ev.pid),
        conversationId: str(ev.conversation_id),
        timeoutSeconds: num(ev.timeout_seconds),
      })
      continue
    }
    const run = runs.get(ev.id)
    if (ev.event === 'label') {
      if (run !== undefined && typeof ev.label === 'string') run.label = ev.label
    } else if (ev.event === 'progress') {
      if (run === undefined) continue
      run.tokens = sumTokens(ev.usage) ?? num(ev.tokens) ?? run.tokens
      run.contextPct = num(ev.context_pct) ?? run.contextPct
      run.step = str(ev.step) ?? run.step
      run.steps = num(ev.steps) ?? run.steps
      run.errors = num(ev.errors) ?? run.errors
    } else if (ev.event === 'end') {
      const duration = num(ev.duration_seconds) ?? 0
      // An end whose start was never logged (the mod loaded mid-run) still counts.
      const ended: Run = run ?? {
        id: ev.id,
        kind,
        label: String(ev.label || ev.agent_type || ev.id),
        status: 'done',
        startedAt: ev.ts - duration,
      }
      runs.set(ev.id, ended)
      ended.status = String(ev.status ?? 'done')
      ended.endedAt = ev.ts
      ended.durationSeconds = num(ev.duration_seconds) ?? ev.ts - ended.startedAt
      ended.turns = num(ev.num_turns)
      ended.tokens = sumTokens(ev.usage) ?? ended.tokens
      ended.summary = str(ev.summary)
      ended.conversationId = str(ev.conversation_id) ?? ended.conversationId
      ended.step = undefined
    }
  }
  return [...runs.values()]
    .filter(run => now - run.startedAt < WINDOW_SECONDS || run.status === 'running')
    .map(run =>
      run.status === 'running' && now - run.startedAt > STALE_SECONDS ? { ...run, status: 'stale' } : run,
    )
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, KEEP)
}

// What a run's live log says it is doing: its last tool line, and counts.
export function readLiveLog(text: string): Pick<Run, 'step' | 'steps' | 'errors'> {
  const lines = text.split('\n')
  const tools = lines.filter(line => line.startsWith('▸ '))
  const errors = lines.filter(line => /^\s+✗ /.test(line)).length
  const last = tools[tools.length - 1]
  return { step: last === undefined ? undefined : last.slice(2), steps: tools.length, errors }
}

const DEMO_STEPS = [
  'get_scene_info {}',
  'execute_blender_code {"code":"import bpy; bpy.ops.mesh.primitive_plane_add(size=10)"}',
  'execute_blender_code {"code":"mat = bpy.data.materials.new(\'MatteGrey\')"}',
  'get_viewport_screenshot {"max_size":512}',
  'view_file {"AbsolutePath":"/tmp/shot.png"}',
]

// Made-up runs that move with the clock, to see the dashboard without running anything.
export function demoRuns(now: number, since: number): Run[] {
  const t = Math.max(0, now - since)
  const growing = (base: number, rate: number) => Math.round(base + t * rate)
  const blender = growing(46_000, 520)
  const tests = growing(121_000, 300)
  return [
    {
      id: 'demo-agy-1', kind: 'agy', isDemo: true, status: 'running',
      label: 'Blender: dựng cảnh 2D, ground plane + material MatteGrey',
      startedAt: since - 74, cwd: '~/code/blender', pid: 0, timeoutSeconds: 600,
      step: DEMO_STEPS[Math.floor(t / 3) % DEMO_STEPS.length], steps: 9 + Math.floor(t / 3),
      errors: t > 20 ? 1 : 0, tokens: blender, contextPct: Math.min(99, Math.round((blender / CONTEXT_TOKENS) * 100)),
    },
    {
      id: 'demo-agy-2', kind: 'agy', isDemo: true, status: 'running',
      label: 'Viết unit test cho parser.py (edge cases rỗng, unicode)',
      startedAt: since - 470, cwd: '~/code/claude-mods', pid: 0, timeoutSeconds: 600,
      step: t % 6 < 3 ? 'run_command {"CommandLine":"pytest -q tests/test_parser.py"}' : 'edit_file {"path":"tests/test_parser.py"}',
      steps: 31 + Math.floor(t / 4), errors: 3, tokens: tests,
      contextPct: Math.min(99, Math.round((tests / CONTEXT_TOKENS) * 100)),
    },
    {
      id: 'demo-sub-1', kind: 'subagent', isDemo: true, status: 'running',
      label: 'Explore: tìm chỗ xử lý auth token trong src/',
      startedAt: since - 18, step: t % 4 < 2 ? 'Grep {"pattern":"refresh_token"}' : 'Read {"file_path":"src/auth/session.ts"}',
      steps: 4 + Math.floor(t / 2), errors: 0, tokens: growing(9_000, 260),
    },
    {
      id: 'demo-agy-3', kind: 'agy', isDemo: true, status: 'SUCCESS',
      label: 'Blender: thêm ground plane 10x10', startedAt: since - 900, endedAt: since - 806,
      durationSeconds: 94, turns: 1, tokens: 98_098, cwd: '~/code/blender', conversationId: '5dc55299-bc6e-412e-ac42-6d9efe187fe8',
      summary: 'The requested scene setup has been completed: Ground Plane (10×10, MatteGrey, roughness 0.9).',
    },
    {
      id: 'demo-agy-4', kind: 'agy', isDemo: true, status: 'EMPTY',
      label: 'Blender: animation quả bóng nảy (grease pencil)', startedAt: since - 1700, endedAt: since - 1106,
      durationSeconds: 594, turns: 1, tokens: 342_591, cwd: '~/code/blender', conversationId: '78eee84f-8418-4bdf-aa14-a75f9766dcfc',
      summary: 'print timeout after 10m0s with turn in progress; returning partial output',
    },
    {
      id: 'demo-agy-5', kind: 'agy', isDemo: true, status: 'DENIED',
      label: 'Dọn thư mục build/ và chạy lại make', startedAt: since - 2600, endedAt: since - 2570,
      durationSeconds: 30, turns: 2, tokens: 12_400, cwd: '~/code/app', summary: 'denied: rm -rf build/',
    },
  ]
}
// A made-up live log for a demo run, growing with its steps.
export function demoLog(run: Run): string {
  const lines = [`▶ ${run.kind} ${run.id}  (${run.cwd ?? '~'})`, `  task: ${run.label}`]
  const steps = run.steps ?? 3
  for (let i = 0; i < steps; i++) {
    lines.push(`Bước ${i + 1}: xem lại kết quả trước rồi làm tiếp.`)
    lines.push(`▸ ${DEMO_STEPS[i % DEMO_STEPS.length]}`)
    if (i % 7 === 6) lines.push(`  ✗ ${DEMO_STEPS[i % DEMO_STEPS.length]?.split(' ')[0]}: FAILED`)
  }
  if (run.status !== 'running') lines.push('', `■ END ${run.status} · ${Math.round(run.durationSeconds ?? 0)}s`)
  return lines.join('\n')
}

// The last `count` lines of a log, its trailing blank lines left out.
export function lastLines(text: string, count: number): string[] {
  const lines = text.replace(/\s+$/, '').split('\n')
  return text.trim() === '' ? [] : lines.slice(-count)
}

// Splits the log's lines into those to keep and those to archive, by age; an unreadable line is kept.
export function splitByAge(text: string, cutoff: number): { keep: string[]; old: string[] } {
  const keep: string[] = []
  const old: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let ts: unknown
    try {
      ts = (JSON.parse(line) as LogEvent).ts
    } catch {
      ts = undefined
    }
    if (typeof ts === 'number' && ts < cutoff) old.push(line)
    else keep.push(line)
  }
  return { keep, old }
}

// Keeps the last `bytes` of text, from a whole line on.
export function tailLines(text: string, bytes: number): string {
  if (text.length <= bytes) return text
  const cut = text.slice(text.length - bytes)
  return cut.slice(cut.indexOf('\n') + 1)
}

// How a live-log line is drawn: tool calls, failures and the end mark stand out.
export function logLook(line: string): { color?: string; dimColor?: boolean; bold?: boolean } {
  if (line.startsWith('▸ ')) return { color: 'suggestion' }
  if (/^\s+✗ /.test(line)) return { color: 'error' }
  if (/^\s+↳ /.test(line) || line.startsWith('  task: ')) return { dimColor: true }
  if (line.startsWith('▶ ') || line.startsWith('■ END')) return { bold: true }
  return {}
}
