import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, LimitSample, Peers, Review, Run, SessionView, SkillUse, TurnStat } from '../types'
import { addSample, delegatePrompt, isSession, parseTell, resetAtSeconds, sparkline, toPeers } from './extras'
import { looksDelegable } from './hint'
import { holdReason, isAgyLaunch, mark, pendingOf, REVIEW_NOTE, reviewedBy, syncReviews } from './review'
import { demoLog, demoRuns, describeRow, fold, lastLines, logLook, readLiveLog, splitByAge, tailLines } from './runs'
import { toSessionView } from './session'
import {
  CARD_LOG_LINES, CTX_COMPACT, CTX_WARN, HINT_GAP_SECONDS, LOG_PANE, LOG_PANE_LINES, LOG_REL, LOG_TAIL_BYTES, LONG_TURN_SECONDS, PANE,
  PEERS_POLL_MS, POLL_MS, RUNS_REL, SESSION_POLL_MS, TITLE,
} from './state'
import { report, summarize } from './usage'
import { bar, clock, compact, heat, isFailed, limitName, lookOf, outlook, resetIn, short, span, turnLine } from './util'
import type { LogEvent } from './util'

// What the tests read from here.
export { demoLog, demoRuns, describeRow, fold, lastLines, logLook, readLiveLog, splitByAge, tailLines } from './runs'
export { toSessionView } from './session'
export { bar, compact, limitName, lookOf, outlook, resetIn, span, turnLine } from './util'

const board = atom({ plugin: 'agent-dashboard', key: 'board' } as const, { runs: [], now: 0 } as Board)
const selected = atom({ plugin: 'agent-dashboard', key: 'selected' } as const, null as string | null)
const demoSince = atom({ plugin: 'agent-dashboard', key: 'demoSince' } as const, null as number | null)
const sessionView = atom({ plugin: 'agent-dashboard', key: 'session' } as const, null as SessionView | null)
const skillUses = atom({ plugin: 'agent-dashboard', key: 'skills' } as const, [] as SkillUse[])
const sessionError = atom({ plugin: 'agent-dashboard', key: 'sessionError' } as const, null as string | null)
const toolCounts = atom({ plugin: 'agent-dashboard', key: 'tools' } as const, {} as Record<string, number>)
const limitHistory = atom({ plugin: 'agent-dashboard', key: 'limitHistory' } as const, [] as LimitSample[])
const lastTurn = atom({ plugin: 'agent-dashboard', key: 'lastTurn' } as const, null as TurnStat | null)
const peers = atom({ plugin: 'agent-dashboard', key: 'peers' } as const, null as Peers | null)
const tellTarget = atom({ plugin: 'agent-dashboard', key: 'tellTarget' } as const, null as string | null)
const isNotifyOn = atom({ plugin: 'agent-dashboard', key: 'isNotifyOn' } as const, true)
// When this session launched agy-tracked, epoch seconds: which runs on the board are its own.
const agyCalls = atom({ plugin: 'agent-dashboard', key: 'agyCalls' } as const, [] as number[])
const reviews = atom({ plugin: 'agent-dashboard', key: 'reviews' } as const, [] as Review[])
const isHintOn = atom({ plugin: 'agent-dashboard', key: 'isHintOn' } as const, true)
// When the last delegate hint showed, so they come at most one per HINT_GAP_SECONDS.
const hintAt = atom({ plugin: 'agent-dashboard', key: 'hintAt' } as const, 0)
const logRun = atom({ plugin: 'agent-dashboard', key: 'logRun' } as const, null as string | null)
const logs = atom({ plugin: 'agent-dashboard', key: 'logs' } as const, {} as Record<string, string>)
const isFollowing = atom({ plugin: 'agent-dashboard', key: 'isFollowing' } as const, true)

// Everything below takes `$`, which the engine follows only within this file:
// the pure parts live in the modules imported above.

// The highest context alert raised so far, so each fires once on the way up.
let ctxAlerted = 0
// The last rate-limit reading, kept across sessions so a new one shows it before its first reply.
const LIMITS_KEY = 'lastLimits'
type KeptLimits = { limits: SessionView['limits']; history: LimitSample[] }
let lastKeptLimits: SessionView['limits'] | undefined

// This session's figures, from the status line's usage and /context's local estimate.

// The main loop's turn in progress.
let turn: { startedAt: number; costBefore?: number; tools: number } | null = null

// Subagents whose task prompt already named them; one label each.
const labeled = new Set<string>()

// Shows, at most once per HINT_GAP_SECONDS, that a prompt reads like a job for /delegate.
async function maybeHint($: EngineInterface, text: string, at: number) {
  if (!(await read($, isHintOn)) || !looksDelegable(text)) return
  if (at - (await read($, hintAt)) < HINT_GAP_SECONDS) return
  await update($, hintAt, () => at)
  $.ui.toast('💡 Việc này có vẻ nhỏ: lần sau thử /delegate <việc> để giao cho agy (tắt: /agent-board hints)')
}

// Last status seen per run, to toast a run once as it ends.
const seen = new Map<string, string>()

export async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? '~'
}

export async function bin($: EngineInterface, name: string): Promise<string> {
  return `${await home($)}/.local/bin/${name}`
}

export async function emit($: EngineInterface, event: LogEvent) {
  await $.process.run([await bin($, 'agent-event'), JSON.stringify(event)])
}

// Appends text to the run's live log, which its tmux pane follows.
export async function runLog($: EngineInterface, id: string, text: string) {
  await $.process.run([await bin($, 'agent-event'), 'log', id, text])
}

// A native notification, for when the person is not looking; a toast when none can be sent.
export async function notify($: EngineInterface, text: string) {
  if (!(await read($, isNotifyOn))) return
  try {
    const sent = await $.ui.notify(text, { title: 'Claude · agents' })
    if (!sent.isSent) $.ui.toast(text)
  } catch {
    $.ui.toast(text)
  }
}

export async function refreshSession($: EngineInterface) {
  const problems: string[] = []
  const attempt = async <T,>(what: string, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run()
    } catch (error) {
      problems.push(`${what}: ${short(error instanceof Error ? error.message : error, 120)}`)
      return undefined
    }
  }
  // The breakdown is an estimate on top; without it the status line's figures still show.
  const usage =
    (await attempt('usage+breakdown', () => $.session.usage({ breakdown: 'summary', columns: 80 }))) ??
    (await attempt('usage', () => $.session.usage()))
  const model = (await attempt('model', () => $.session.model())) ?? '?'
  const turns = (await attempt('turns', () => $.session.turns())) ?? 0
  const problem = problems.length === 0 ? null : problems.join(' · ')
  if ((await read($, sessionError)) !== problem) await update($, sessionError, () => problem)
  if (usage === undefined) return
  const view = toSessionView(usage, model, turns)
  // Rate limits arrive with the first reply; until then, the last reading any session kept.
  if (view.limits.length > 0) {
    if (JSON.stringify(view.limits) !== JSON.stringify(lastKeptLimits)) {
      lastKeptLimits = view.limits
      await $.store.set(LIMITS_KEY, { limits: view.limits, history: await read($, limitHistory) }).catch(() => {})
    }
  } else {
    const kept = (await $.store.get(LIMITS_KEY).catch(() => undefined)) as KeptLimits | undefined
    // A window that has reset since is no longer what it said.
    const nowSeconds = (await $.clock.now()) / 1000
    const live = (kept?.limits ?? []).filter(one => (resetAtSeconds(one.resetsAt) ?? Infinity) > nowSeconds)
    if (kept !== undefined && live.length > 0) {
      view.limits = live
      view.isLimitsKept = true
      if ((await read($, limitHistory)).length === 0 && kept.history.length > 0) await update($, limitHistory, () => kept.history)
    }
  }
  const old = await read($, sessionView)
  if (JSON.stringify(old) !== JSON.stringify(view)) await update($, sessionView, () => view)

  const five = view.limits.find(one => one.kind === 'five_hour')
  if (five !== undefined && view.isLimitsKept !== true) {
    const t = (await $.clock.now()) / 1000
    const before = await read($, limitHistory)
    const after = addSample(before, { t, pct: five.percentUsed })
    if (after.length !== before.length || after[0]?.t !== before[0]?.t) await update($, limitHistory, () => after)
  }

  const pct = view.percent ?? 0
  if (pct < CTX_WARN - 5) ctxAlerted = 0
  if (pct >= CTX_COMPACT && ctxAlerted < CTX_COMPACT) {
    ctxAlerted = CTX_COMPACT
    $.ui.toast(`ctx ${pct}%: nên /compact (nút Compact ở dòng trên ô nhập)`)
    void notify($, `Context đã dùng ${pct}%: nên compact`)
  } else if (pct >= CTX_WARN && ctxAlerted < CTX_WARN) {
    ctxAlerted = CTX_WARN
    $.ui.toast(`ctx ${pct}%: context đang đầy dần`)
  }
}

export async function refreshPeers($: EngineInterface) {
  const at = (await $.clock.now()) / 1000
  try {
    const called = await $.tool.call({ tool: 'ListAgents' })
    if (called.deny !== undefined) throw new Error(called.deny)
    const value: Peers = { list: toPeers(called.result), at }
    await update($, peers, () => value)
  } catch (error) {
    const reason = short(error instanceof Error ? error.message : error, 140)
    await update($, peers, old => ({ list: old?.list ?? [], at, error: reason }))
  }
}

export async function refresh($: EngineInterface) {
  const now = (await $.clock.now()) / 1000
  const base = await home($)
  let text = ''
  try {
    text = await $.fs.read(`${base}/${LOG_REL}`)
  } catch {
    // No log yet: nothing has run.
  }
  const real = fold(text, now)
  // Running runs: what each is doing now, from its live log.
  for (const run of real) {
    if (run.status !== 'running') continue
    try {
      const live = readLiveLog(await $.fs.read(`${base}/${RUNS_REL}/${run.id}.log`))
      run.step = run.step ?? live.step
      run.steps = run.steps ?? live.steps
      run.errors = run.errors ?? live.errors
    } catch {
      // No live log for this run.
    }
  }
  const since = await read($, demoSince)
  const runs = since === null ? real : [...demoRuns(now, since), ...real]

  for (const run of runs) {
    const before = seen.get(run.id)
    if (before === 'running' && run.status !== 'running') {
      const look = lookOf(run.status)
      $.ui.toast(`${look.icon} ${run.kind} ${look.word}: ${short(run.label, 60)}`)
      if (run.isDemo !== true) void notify($, `${look.icon} ${run.kind} ${look.word}: ${short(run.label, 80)}`)
    }
    seen.set(run.id, run.status)
  }

  // This session's agy runs, pending review as each ends.
  const calls = await read($, agyCalls)
  let synced = await read($, reviews)
  if (syncReviews(synced, real, calls).length !== synced.length) {
    await update($, reviews, current => syncReviews(current, real, calls))
    synced = await read($, reviews)
  }

  const old = await read($, board)
  const isRunning = runs.some(run => run.status === 'running')
  const isSame = JSON.stringify(old.runs) === JSON.stringify(runs)
  // Redraw on any change, and every tick while something runs so its clock moves.
  // Also once a minute while idle, so reset countdowns move.
  const isNewMinute = Math.floor(now / 60) !== Math.floor(old.now / 60)
  if (!isSame || isRunning || isNewMinute) await update($, board, () => ({ runs, now }))
  if (isRunning && !old.runs.some(run => run.status === 'running')) {
    // Opening unasked may be declined (a narrow terminal); the band still shows.
    $.ui.open({ id: PANE, title: TITLE }).catch(() => {})
  }

  const running = runs.filter(run => run.status === 'running')
  const tokens = running.reduce((sum, run) => sum + (run.tokens ?? 0), 0)
  const me = await read($, sessionView)
  const parts = [
    me?.percent !== undefined ? `ctx ${me.isEstimate === true ? '~' : ''}${me.percent}%` : '',
    running.length > 0 ? `⧉ ${running.length} agent${tokens > 0 ? ` ${compact(tokens)} tok` : ''}` : '',
    pendingOf(synced).length > 0 ? `⚑ ${pendingOf(synced).length} chưa review` : '',
  ].filter(Boolean)
  $.ui.status(parts.length === 0 ? undefined : parts.join(' · '))
  await refreshLogs($)
}

// The tail of a run's live log: read whole while small, else its last LOG_TAIL_BYTES.
async function readTail($: EngineInterface, run: Run): Promise<string> {
  if (run.isDemo === true) return demoLog(run)
  const path = `${await home($)}/${RUNS_REL}/${run.id}.log`
  try {
    const { size } = await $.fs.stat(path)
    if (size <= LOG_TAIL_BYTES) return await $.fs.read(path)
    return tailLines((await $.process.run(['tail', '-c', String(LOG_TAIL_BYTES), path])).stdout, LOG_TAIL_BYTES)
  } catch {
    return ''
  }
}

// Reads the logs someone is looking at: the open card's run and the log pane's.
export async function refreshLogs($: EngineInterface) {
  const { runs } = await read($, board)
  const followed = await read($, logRun)
  const ids = [...new Set([await read($, selected), followed])].filter((id): id is string => id !== null)
  const fresh: Record<string, string> = {}
  for (const id of ids) {
    const run = runs.find(one => one.id === id)
    if (run !== undefined) fresh[id] = await readTail($, run)
  }
  const old = await read($, logs)
  if (JSON.stringify(old) === JSON.stringify(fresh)) return
  await update($, logs, () => fresh)
  if (followed !== null && old[followed] !== fresh[followed] && (await read($, isFollowing))) {
    await $.ui.scroll({ in: LOG_PANE, to: 'end' }).catch(() => {})
  }
}

// Points the log pane at a run and opens it.
export async function openLog($: EngineInterface, run: Run) {
  await update($, logRun, () => run.id)
  await update($, isFollowing, () => true)
  await refreshLogs($)
  await $.ui.open({ id: LOG_PANE, title: `Log · ${run.kind} · ${short(run.label, 40)}` })
  await $.ui.scroll({ in: LOG_PANE, to: 'end' }).catch(() => {})
}

// The event log is rotated past this size: lines older than KEEP_DAYS move to the archive.
const ROTATE_BYTES = 1024 * 1024
const KEEP_DAYS = 30
// The archive keeps its newest lines up to this size.
const ARCHIVE_BYTES = 3 * 1024 * 1024
const ARCHIVE_REL = '.claude/agent-events.archive.jsonl'

// Rotates the event log once it grows past ROTATE_BYTES; run once per session start.
export async function rotateLog($: EngineInterface): Promise<string | undefined> {
  const base = await home($)
  const path = `${base}/${LOG_REL}`
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined || stat.size < ROTATE_BYTES) return undefined
  const now = (await $.clock.now()) / 1000
  // Past what one read takes, the tail alone is readable; the head is lost to the archive's cap anyway.
  const text =
    stat.size < 4 * 1024 * 1024 - 1
      ? await $.fs.read(path)
      : tailLines((await $.process.run(['tail', '-c', String(ARCHIVE_BYTES), path])).stdout, ARCHIVE_BYTES)
  const { keep, old } = splitByAge(text, now - KEEP_DAYS * 86_400)
  // Still too big with only recent lines: the newest part stays, the rest joins the archive too.
  const keepText = keep.map(line => `${line}\n`).join('')
  const kept = tailLines(keepText, ROTATE_BYTES / 2)
  const overflow = keepText.slice(0, keepText.length - kept.length)
  const archived = await $.fs.read(`${base}/${ARCHIVE_REL}`).catch(() => '')
  const moved = old.map(line => `${line}\n`).join('') + overflow
  await $.fs.write(`${base}/${ARCHIVE_REL}`, tailLines(archived + moved, ARCHIVE_BYTES))
  // Writers append while this runs: whatever landed after the read is carried over.
  const again = stat.size < 4 * 1024 * 1024 - 1 ? await $.fs.read(path).catch(() => text) : text
  const appended = again.startsWith(text) ? again.slice(text.length) : ''
  await $.fs.write(path, kept + appended)
  return `agent-events.jsonl: ${moved.split('\n').length - 1} dòng cũ chuyển vào archive, giữ ${kept.split('\n').length - 1} dòng`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Each on its own: a name the engine refuses (a built-in, say) costs that command alone,
    // not the rest of this hook.
    const refused = (name: string) => (err: unknown) => $.ui.toast(`agent-dashboard: /${name} không đăng ký được: ${String(err)}`)
    await $.command
      .register({
        name: 'agent-board',
        description: 'Mở bảng theo dõi agent (agy, subagent). "/agent-board demo": dữ liệu mẫu, "/agent-board notify": bật/tắt thông báo, "/agent-board hints": bật/tắt gợi ý /delegate',
        argumentHint: '[demo|notify|hints]',
      })
      .catch(refused('agent-board'))
    await $.command
      .register({
        name: 'delegate',
        description: 'Giao một việc nhỏ cho agy: Claude viết brief, chạy agy-tracked, rồi review kết quả',
        argumentHint: '<việc cần làm>',
      })
      .catch(refused('delegate'))
    await $.command
      .register({
        name: 'tell',
        description: 'Gửi tin cho một session/agent khác: /tell <tên> <nội dung>',
        argumentHint: '<tên> <nội dung>',
      })
      .catch(refused('tell'))
    await $.command
      .register({ name: 'broadcast', description: 'Gửi cùng một tin cho mọi session khác trên máy', argumentHint: '<nội dung>' })
      .catch(refused('broadcast'))
    await $.command
      .register({ name: 'sessions', description: 'Liệt kê các session/agent có thể nhắn, trong bảng Agents' })
      .catch(refused('sessions'))
    await $.command
      .register({
        name: 'usage-report',
        description: 'Báo cáo usage theo ngày: lượt Claude, token, chi phí, so với agy và subagent',
        argumentHint: '[số ngày, mặc định 7]',
      })
      .catch(refused('usage-report'))
    // Once per session start: the event log is cut back when it has grown large.
    void rotateLog($)
      .then(done => (done === undefined ? undefined : $.ui.toast(done)))
      .catch(() => {})
    $.clock.every(PEERS_POLL_MS, () => {
      // Only once the person has asked for the list: ListAgents is not called unasked.
      void read($, peers).then(known => (known === null ? undefined : refreshPeers($)))
    })
    $.clock.every(POLL_MS, () => void refresh($))
    $.clock.every(SESSION_POLL_MS, () => void refreshSession($))
    void refresh($)
    void refreshSession($)

    return next(e)
  })

  on('command.run', { command: 'delegate' }, async ($, e) => {
    const task = (e.args ?? '').trim()
    if (task === '') return { text: 'Cách dùng: /delegate <việc cần làm>, ví dụ /delegate thêm test cho hàm parse_date trong utils.py' }
    void $.prompt.submit({ text: delegatePrompt(task) })

    return { text: `Đang giao cho agy: ${short(task, 120)}` }
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await refreshPeers($)
    await $.ui.open({ id: PANE, title: TITLE })
    const known = await read($, peers)
    if (known?.error !== undefined) return { text: `Không lấy được danh sách: ${known.error}` }

    return { text: `${known?.list.length ?? 0} session/agent có thể nhắn: ${(known?.list ?? []).map(one => one.name).join(', ') || 'không có'}` }
  })

  on('command.run', { command: 'tell' }, async ($, e) => {
    const parsed = parseTell(e.args ?? '')
    if (parsed === undefined) return { text: 'Cách dùng: /tell <tên> <nội dung>. Xem tên bằng /sessions.' }
    const sent = await $.session.send({ to: parsed.to, text: parsed.text })

    return { text: sent.isDelivered ? `Đã gửi tới ${parsed.to}.` : `Không gửi được tới ${parsed.to}: ${sent.reason}` }
  })

  on('command.run', { command: 'broadcast' }, async ($, e) => {
    const text = (e.args ?? '').trim()
    if (text === '') return { text: 'Cách dùng: /broadcast <nội dung>' }
    await refreshPeers($)
    const targets = ((await read($, peers))?.list ?? []).filter(isSession)
    if (targets.length === 0) return { text: 'Không thấy session nào khác để gửi (xem /sessions).' }
    const results = await Promise.all(targets.map(peer => $.session.send({ to: peer.name, text })))
    const failed = targets.filter((_, i) => !results[i]?.isDelivered).map(peer => peer.name)

    return {
      text: `Đã gửi tới ${targets.length - failed.length}/${targets.length} session${failed.length > 0 ? `; lỗi: ${failed.join(', ')}` : ''}.`,
    }
  })

  on('command.run', { command: 'agent-board' }, async ($, e) => {
    if (/\bhints?\b/.test(e.args ?? '')) {
      const was = await read($, isHintOn)
      await update($, isHintOn, () => !was)
      return { text: was ? 'Đã tắt gợi ý /delegate.' : 'Đã bật gợi ý /delegate.' }
    }
    if (/\bnotify\b/.test(e.args ?? '')) {
      const was = await read($, isNotifyOn)
      await update($, isNotifyOn, () => !was)
      return { text: was ? 'Đã tắt thông báo hệ thống.' : 'Đã bật thông báo hệ thống.' }
    }
    if (/\bdemo\b/.test(e.args ?? '')) {
      const now = (await $.clock.now()) / 1000
      const was = await read($, demoSince)
      await update($, demoSince, () => (was === null ? now : null))
      await refresh($)
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: was === null ? 'Đã bật dữ liệu mẫu trong bảng Agents.' : 'Đã tắt dữ liệu mẫu.' }
    }
    await refresh($)
    const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE })

    return {
      text: isPlaced
        ? 'Đã mở bảng Agents.'
        : 'Bảng Agents đã mở nhưng chưa có chỗ hiện: mở rộng cửa sổ terminal (dock cần ~110 cột ở chế độ fullscreen). Số liệu chính vẫn ở dòng trên ô nhập.',
    }
  })

  on('command.run', { command: 'usage-report' }, async ($, e) => {
    const days = Math.max(1, Math.min(90, Number.parseInt((e.args ?? '').trim(), 10) || 7))
    const base = await home($)
    const now = (await $.clock.now()) / 1000
    // Older lines live in the archive once the log has been rotated.
    const archived = await $.fs.read(`${base}/.claude/agent-events.archive.jsonl`).catch(() => '')
    const text = await $.fs.read(`${base}/${LOG_REL}`).catch(() => '')

    return { text: report(summarize(`${archived}\n${text}`, now, days, -new Date().getTimezoneOffset()), days) }
  })

  // Subagents: start, every row of their conversation, and stop go to the event log and live log.
  on('classic.SubagentStart', async ($, e, next) => {
    void (async () => {
      await emit($, {
        id: e.agent_id,
        kind: 'subagent',
        event: 'start',
        agent_type: e.agent_type,
        description: e.agent_type,
        session_id: e.session_id,
        ts: (await $.clock.now()) / 1000,
      })
      await runLog($, e.agent_id, `▶ subagent ${e.agent_type} ${e.agent_id}\n`)
      await $.process.run([await bin($, 'agent-watch'), e.agent_id, `sub: ${e.agent_type}`])
      await refresh($)
    })().catch(() => {})

    return next(e)
  }).catch(($, e, next) => next(e)) // logging never holds a subagent back

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const id = e.agentId
    if (id === undefined || e.message.isMeta === true) return stored
    const text = describeRow(e.message.content)
    if (text === '') return stored
    void (async () => {
      if (!labeled.has(id) && e.message.role === 'user' && !text.startsWith('  ')) {
        labeled.add(id)
        await emit($, { id, event: 'label', label: short(text, 80), ts: (await $.clock.now()) / 1000 })
        await runLog($, id, `  task: ${short(text, 300)}\n`)
      } else {
        await runLog($, id, text)
      }
    })().catch(() => {})

    return stored
  }).catch(($, e, next) => next(e)) // a failed log line never touches the row

  on('classic.SubagentStop', async ($, e, next) => {
    await emit($, {
      id: e.agent_id,
      kind: 'subagent',
      event: 'end',
      status: 'done',
      agent_type: e.agent_type,
      summary: (e.last_assistant_message ?? '').slice(0, 300),
      ts: (await $.clock.now()) / 1000,
    })
    await runLog($, e.agent_id, '\n■ END done')
    void refresh($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Which skills this session called, and how often.
  on('skill.prompt', async ($, e, next) => {
    const at = (await $.clock.now()) / 1000
    await update($, skillUses, list => {
      const found = list.find(one => one.name === e.skill)
      const rest = list.filter(one => one.name !== e.skill)
      return [{ name: e.skill, count: (found?.count ?? 0) + 1, lastAt: at }, ...rest]
    })

    return next(e)
  }).catch(($, e, next) => next(e)) // counting never holds a skill back

  on('prompt.submit', async ($, e, next) => {
    const costBefore = (await $.session.usage().catch(() => undefined))?.cost?.usd
    const at = (await $.clock.now()) / 1000
    turn = { startedAt: at, costBefore, tools: 0 }
    void maybeHint($, e.text, at).catch(() => {})

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined && turn !== null) turn.tools += 1
    await update($, toolCounts, counts => ({ ...counts, [e.tool]: (counts[e.tool] ?? 0) + 1 }))
    if (e.agentId !== undefined) return next(e)
    const at = (await $.clock.now()) / 1000
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'Bash' && isAgyLaunch(e.command)) await update($, agyCalls, calls => [...calls, at].slice(-50))
    const ran = await next(e)
    try {
      // A run that ended a moment ago may not be on the board yet.
      if (['Bash', 'Read', 'Grep', 'Glob'].includes(e.tool) && (await read($, agyCalls)).length > 0) await refresh($)
      const ids = reviewedBy(e.tool, input, pendingOf(await read($, reviews)), at)
      if (ids.length > 0 && ran.deny === undefined) await update($, reviews, list => mark(list, ids, 'reviewed'))
    } catch {
      // The call has run: a failed count never runs it again.
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    void refreshSession($)
    if (e.agentId === undefined) {
      void (async () => {
        const costAfter = (await $.session.usage().catch(() => undefined))?.cost?.usd
        const usage = e.usage
        const stat: TurnStat = {
          seconds: Math.round(e.durationMs / 1000),
          inputTokens:
            usage === undefined
              ? undefined
              : usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage?.output_tokens,
          costUsd: costAfter !== undefined && turn?.costBefore !== undefined ? costAfter - turn.costBefore : undefined,
          tools: turn?.tools ?? 0,
          endedAt: (await $.clock.now()) / 1000,
        }
        turn = null
        await update($, lastTurn, () => stat)
        await emit($, {
          kind: 'claude', event: 'turn', seconds: stat.seconds, input_tokens: stat.inputTokens,
          output_tokens: stat.outputTokens, cost_usd: stat.costUsd, tools: stat.tools, ts: stat.endedAt,
        })
        const pending = pendingOf(await read($, reviews))
        if (pending.length > 0) $.ui.toast(`⚑ ${pending.length} lần chạy agy chưa review: ${short(pending[0]?.label, 50)}`)
        if (stat.seconds >= LONG_TURN_SECONDS && !e.isAborted) void notify($, `Claude xong lượt sau ${clock(stat.seconds)}`)
      })().catch(() => {})
    }

    return next(e)
  })

  // The model reads, with every agy-tracked result, that it must check the work before reporting it.
  on('classic.PostToolUse', async ($, e, next) => {
    const below = await next(e)
    const input = e.tool_input as { command?: unknown } | undefined
    if (e.agent_id !== undefined || e.tool_name !== 'Bash' || typeof input?.command !== 'string' || !isAgyLaunch(input.command)) return below

    return { ...below, additionalContext: [...(below.additionalContext ?? []), REVIEW_NOTE] }
  }).catch(($, e, next) => next(e))

  // A turn may not end while an agy run it launched is unchecked: held once per run, then let go.
  on('classic.Stop', async ($, e, next) => {
    const below = await next(e)
    if (below.block !== undefined) return below
    await refresh($)
    const held = pendingOf(await read($, reviews)).filter(one => one.isNudged !== true)
    if (held.length === 0) return below
    const ids = held.map(one => one.id)
    await update($, reviews, list => list.map(one => (ids.includes(one.id) ? { ...one, isNudged: true } : one)))

    return { ...below, block: holdReason(held) }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Mobile draws no text field; there the commands still send.
    const Input = 'Input' in table ? table.Input : undefined
    const { runs } = await read($, board)
    const now = (await $.clock.now()) / 1000
    const open = await read($, selected)
    const isDemo = (await read($, demoSince)) !== null
    const me = await read($, sessionView)
    const meError = await read($, sessionError)
    const history = await read($, limitHistory)
    const turnStat = await read($, lastTurn)
    const reachable = await read($, peers)
    const target = await read($, tellTarget)
    const skills = await read($, skillUses)
    const checks = await read($, reviews)
    const tools = Object.entries(await read($, toolCounts)).sort((a, b) => b[1] - a[1])
    const width = Math.max(24, e.props.bodyColumns)
    const running = runs.filter(run => run.status === 'running')
    const failed = runs.filter(run => isFailed(run.status)).length
    const tokens = runs.reduce((sum, run) => sum + (run.tokens ?? 0), 0)

    const followed = await read($, logRun)
    const tails = await read($, logs)
    const toggle = async (run: Run) => {
      const was = await read($, selected)
      await update($, selected, () => (was === run.id ? null : run.id))
      // The log pane, while open, follows the run just opened.
      if (was !== run.id && followed !== null) await openLog($, run)
      else await refreshLogs($)
    }
    const kill = async (run: Run) => {
      if (run.isDemo === true || run.pid === undefined) {
        $.ui.toast('Run mẫu: không có tiến trình thật để dừng')
        return
      }
      await $.process.run(['kill', '-TERM', String(run.pid)])
      $.ui.toast(`Đã gửi lệnh dừng tới ${run.id}`)
    }
    const tmux = async (run: Run) => {
      if (run.isDemo === true) {
        $.ui.toast('Run mẫu: không có log thật')
        return
      }
      await $.process.run([`${await home($)}/.local/bin/agent-watch`, run.id, `${run.kind}: ${short(run.label, 40)}`])
    }

    const dismiss = (id: string) => update($, reviews, list => mark(list, [id], 'dismissed'))
    const logLine = (line: string, key: string) => (
      <Text key={key} wrap="truncate-end" {...logLook(line)}>
        {line === '' ? ' ' : line}
      </Text>
    )

    const card = (run: Run) => {
      const look = lookOf(run.status)
      const check = checks.find(one => one.id === run.id)
      const isUnchecked = check?.state === 'pending'
      const isOpen = open === run.id
      const isLive = run.status === 'running'
      const elapsed = isLive ? now - run.startedAt : (run.durationSeconds ?? 0)
      const timePct = run.timeoutSeconds ? (elapsed / run.timeoutSeconds) * 100 : 0
      const [ctxOn, ctxOff] = bar(run.contextPct ?? 0)
      const facts = [
        run.steps !== undefined ? `${run.steps} bước` : '',
        run.turns !== undefined ? `${run.turns} lượt` : '',
        run.tokens !== undefined ? `${compact(run.tokens)} tok` : '',
      ].filter(Boolean)

      return (
        <Box key={run.id} flexDirection="column" marginBottom={isOpen ? 1 : 0}>
          <Button key={`row-${run.id}`} plain onPress={() => toggle(run)}>
            <Text color={look.color}>{look.icon} </Text>
            <Text color={run.kind === 'agy' ? 'suggestion' : 'claude'}>{run.kind === 'agy' ? 'agy ' : 'sub '}</Text>
            <Text color={isLive && run.timeoutSeconds ? heat(timePct) : undefined} dimColor={!isLive}>
              {clock(elapsed).padStart(6)}{' '}
            </Text>
            {isUnchecked && <Text color="warning">⚑ </Text>}
            <Text bold={isLive}>{short(run.label, Math.max(10, width - (isUnchecked ? 18 : 16)))}</Text>
          </Button>

          {isLive && run.step !== undefined && (
            <Text wrap="truncate-end">
              <Text dimColor>{'  ▸ '}</Text>
              {run.step}
            </Text>
          )}

          {(facts.length > 0 || run.contextPct !== undefined || isFailed(run.status) || isUnchecked) && (
            <Text wrap="truncate-end">
              {'    '}
              {isFailed(run.status) && <Text color={look.color}>{look.word} · </Text>}
              {isUnchecked && <Text color="warning">chưa review · </Text>}
              {run.contextPct !== undefined && (
                <Text>
                  <Text dimColor>ctx </Text>
                  <Text color={heat(run.contextPct)}>{ctxOn}</Text>
                  <Text dimColor>{ctxOff}</Text>
                  <Text color={heat(run.contextPct)}> {run.contextPct}% </Text>
                </Text>
              )}
              <Text dimColor>{facts.join(' · ')}</Text>
              {(run.errors ?? 0) > 0 && <Text color="error"> · {run.errors} lỗi</Text>}
              {isLive && run.timeoutSeconds !== undefined && (
                <Text color={heat(timePct)}> · còn {clock(run.timeoutSeconds - elapsed)}</Text>
              )}
            </Text>
          )}

          {isOpen && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={look.color}
              paddingX={1}
              width={Math.max(20, width - 2)}
            >
              <Text>
                <Text dimColor>task </Text>
                {run.label}
              </Text>
              {run.cwd !== undefined && (
                <Text wrap="truncate-middle">
                  <Text dimColor>dir  </Text>
                  {run.cwd}
                </Text>
              )}
              <Text wrap="truncate-middle">
                <Text dimColor>id   </Text>
                {run.id}
                {run.conversationId !== undefined && <Text dimColor> · conv {run.conversationId}</Text>}
              </Text>
              {run.summary !== undefined && (
                <Text>
                  <Text dimColor>kết quả </Text>
                  {short(run.summary, 300)}
                </Text>
              )}
              {lastLines(tails[run.id] ?? '', CARD_LOG_LINES).length > 0 && (
                <Box key={`tail-${run.id}`} flexDirection="column" marginTop={1}>
                  <Text dimColor>{isLive ? 'log (trực tiếp)' : 'log'}</Text>
                  {lastLines(tails[run.id] ?? '', CARD_LOG_LINES).map((line, i) => logLine(line, `tail-${run.id}-${i}`))}
                </Box>
              )}
              <Box gap={1} marginTop={1}>
                {isLive && <Button key={`kill-${run.id}`} label="Dừng" hotkey="k" variant="primary" onPress={() => kill(run)} />}
                <Button key={`log-${run.id}`} label="Xem log" hotkey="l" onPress={() => openLog($, run)} />
                {run.kind === 'agy' && <Button key={`tmux-${run.id}`} label="tmux" hotkey="t" onPress={() => tmux(run)} />}
                {isUnchecked && <Button key={`checked-${run.id}`} label="Đã review" hotkey="v" onPress={() => dismiss(run.id)} />}
                <Button key={`close-${run.id}`} label="Thu gọn" hotkey="c" onPress={() => toggle(run)} />
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    const live = runs.filter(run => run.status === 'running')
    const ended = runs.filter(run => run.status !== 'running')

    // The context window as one bar, a segment per /context category in its colour.
    const ctxCells = Math.max(10, Math.min(40, width - 30))
    const segments = (view: SessionView) => {
      const out: { color: string; cells: string; name: string }[] = []
      let used = 0
      for (const row of view.categories) {
        const cells = Math.round((row.tokens / view.window) * ctxCells)
        if (cells === 0 || used + cells > ctxCells) continue
        out.push({ color: row.color, cells: '█'.repeat(cells), name: row.name })
        used += cells
      }
      // No breakdown yet: one segment from the status line's figure.
      if (out.length === 0 && view.percent !== undefined) {
        const cells = Math.round((view.percent / 100) * ctxCells)
        out.push({ color: heat(view.percent), cells: '█'.repeat(cells), name: 'used' })
        used = cells
      }
      return { out, free: '░'.repeat(Math.max(0, ctxCells - used)) }
    }

    const mine = me === null ? (
      <Box flexDirection="column" borderStyle="round" borderColor={meError === null ? 'claude' : 'error'} paddingX={1} width={width}>
        <Text bold color="claude">PHIÊN NÀY</Text>
        <Text dimColor wrap="wrap">{meError === null ? 'Đang lấy số liệu của phiên…' : `Không đọc được số liệu: ${meError}`}</Text>
      </Box>
    ) : (() => {
      const { out, free } = segments(me)
      const pct = me.percent ?? 0
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} width={width}>
          <Text wrap="truncate-end">
            <Text bold color="claude">PHIÊN NÀY </Text>
            <Text>{me.model}</Text>
            <Text dimColor> · {me.turns} lượt</Text>
            {me.costUsd !== undefined && <Text dimColor> · ${me.costUsd.toFixed(2)}</Text>}
          </Text>
          <Text wrap="truncate-end">
            <Text dimColor>ctx </Text>
            {out.map(seg => <Text color={seg.color}>{seg.cells}</Text>)}
            <Text dimColor>{free}</Text>
            <Text color={heat(pct)} bold> {me.percent === undefined ? '—' : `${me.isEstimate === true ? '~' : ''}${pct}%`}</Text>
            <Text dimColor>
              {' '}{me.tokens === undefined ? '' : compact(me.tokens)}/{compact(me.window)}
              {me.autoCompactAt !== undefined ? ` · compact ở ${compact(me.autoCompactAt)}` : ''}
            </Text>
          </Text>
          {me.categories.length > 0 && (
            <Text wrap="wrap">
              {'    '}
              {me.categories.slice(0, 6).map(row => (
                <Text>
                  <Text color={row.color}>■ </Text>
                  <Text dimColor>{row.name} {compact(row.tokens)}  </Text>
                </Text>
              ))}
            </Text>
          )}
          {me.limits.length > 0 && (
            <Text wrap="truncate-end">
              <Text dimColor>hạn mức </Text>
              {me.limits.map(limit => {
                const [filled, empty] = bar(limit.percentUsed, 6)
                return (
                  <Text>
                    <Text dimColor>{limitName(limit.kind)} </Text>
                    <Text color={heat(limit.percentUsed)}>{filled}</Text>
                    <Text dimColor>{empty}</Text>
                    <Text color={heat(limit.percentUsed)}> {me.isLimitsKept === true ? '~' : ''}{Math.round(limit.percentUsed)}%</Text>
                    <Text dimColor> ↻ {resetIn(limit.resetsAt, now)}   </Text>
                  </Text>
                )
              })}
            </Text>
          )}
          {(me.isEstimate === true || me.isLimitsKept === true) && (
            <Text dimColor wrap="truncate-end">~ chưa có lượt nào: ctx là ước tính /context, hạn mức là số đọc của phiên trước</Text>
          )}
          {me.limits.some(one => one.kind === 'five_hour') && (() => {
            const five = me.limits.find(one => one.kind === 'five_hour')
            const look = outlook(history, now, five?.resetsAt)
            return (
              <Text wrap="truncate-end">
                <Text dimColor>xu hướng 5h </Text>
                <Text color={look.color}>{sparkline(history, 16) || '·'}</Text>
                <Text color={look.color}> {look.text}</Text>
              </Text>
            )
          })()}
          <Text wrap="wrap">
            <Text dimColor>skills  </Text>
            {skills.length === 0 ? (
              <Text dimColor>chưa gọi skill nào</Text>
            ) : (
              skills.slice(0, 6).map((one, i) => (
                <Text>
                  {i > 0 ? <Text dimColor> · </Text> : ''}
                  <Text color="suggestion">{one.name}</Text>
                  <Text dimColor> ×{one.count}</Text>
                </Text>
              ))
            )}
            {me.skillsListed !== undefined && (
              <Text dimColor>  ({me.skillsListed} skill có sẵn · {compact(me.skillsTokens ?? 0)} tok)</Text>
            )}
          </Text>
          {meError !== null && <Text color="error" wrap="wrap">{meError}</Text>}
          {turnStat !== null && (
            <Text wrap="truncate-end">
              <Text dimColor>lượt trước </Text>
              {turnLine(turnStat)}
            </Text>
          )}
          {tools.length > 0 && (
            <Text wrap="truncate-end">
              <Text dimColor>tools   </Text>
              {tools.slice(0, 6).map(([name, count], i) => (
                <Text>
                  {i > 0 ? <Text dimColor> · </Text> : ''}
                  {name}
                  <Text dimColor> {count}</Text>
                </Text>
              ))}
            </Text>
          )}
        </Box>
      )
    })()

    return (
      <Box flexDirection="column" width={width}>
        {mine}
        <Box justifyContent="space-between" marginTop={1}>
          <Text>
            <Text bold dimColor>AGENTS  </Text>
            <Text color="warning">● {running.length}</Text>
            <Text dimColor> chạy  </Text>
            <Text color="success">✓ {runs.length - running.length - failed}</Text>
            <Text dimColor> xong  </Text>
            <Text color={failed > 0 ? 'error' : 'subtle'}>✗ {failed}</Text>
            <Text dimColor> lỗi  · {compact(tokens)} tok · 24h</Text>
            {pendingOf(checks).length > 0 && <Text color="warning">  ⚑ {pendingOf(checks).length} chưa review</Text>}
          </Text>
          <Button key="demo" label={isDemo ? 'Demo: bật' : 'Demo'} hotkey="d" plain onPress={async () => {
            const at = (await $.clock.now()) / 1000
            await update($, demoSince, was => (was === null ? at : null))
            await refresh($)
          }} />
        </Box>
        {runs.length === 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Chưa có lần chạy agy hay subagent nào trong 24h.</Text>
            <Text dimColor>Gõ /agent-board demo (hoặc phím d) để xem dữ liệu mẫu.</Text>
          </Box>
        )}
        {live.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold dimColor>ĐANG CHẠY</Text>
            {live.map(card)}
          </Box>
        )}
        {ended.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold dimColor>GẦN ĐÂY</Text>
            {ended.map(card)}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Box justifyContent="space-between">
            <Text>
              <Text bold dimColor>SESSIONS </Text>
              {reachable !== null && <Text dimColor>{reachable.list.length} · cập nhật {span(now - reachable.at)} trước</Text>}
            </Text>
            <Button key="peers" label="Làm mới" hotkey="r" plain onPress={() => refreshPeers($)} />
          </Box>
          {reachable === null && <Text dimColor>Bấm Làm mới (r) hoặc gõ /sessions để xem các session có thể nhắn.</Text>}
          {reachable?.error !== undefined && <Text color="error" wrap="wrap">{reachable.error}</Text>}
          {reachable !== null && reachable.list.length === 0 && reachable.error === undefined && (
            <Text dimColor>Không có session hay agent nào khác.</Text>
          )}
          {(reachable?.list ?? []).map(peer => (
            <Button key={`peer-${peer.name}`} plain onPress={() => update($, tellTarget, was => (was === peer.name ? null : peer.name))}>
              <Text color={target === peer.name ? 'claude' : isSession(peer) ? 'suggestion' : 'subtle'}>
                {target === peer.name ? '▶ ' : '  '}
                {peer.name}
              </Text>
              <Text dimColor>
                {'  '}
                {[peer.type ?? peer.section, peer.status].filter(Boolean).join(' · ')}
              </Text>
            </Button>
          ))}
          {target !== null && Input !== undefined && (
            <Input
              key="tell"
              label={`Gửi tới ${target}`}
              placeholder="nội dung, Enter để gửi"
              submitLabel="Gửi"
              autoFocus
              onSubmit={async (value: string) => {
                const text = value.trim()
                if (text === '') return
                const sent = await $.session.send({ to: target, text })
                $.ui.toast(sent.isDelivered ? `Đã gửi tới ${target}` : `Không gửi được: ${sent.reason}`)
                if (sent.isDelivered) await update($, tellTarget, () => null)
              }}
            />
          )}
          <Text dimColor>/tell &lt;tên&gt; &lt;nội dung&gt; · /broadcast &lt;nội dung&gt; · /delegate &lt;việc&gt;</Text>
        </Box>
      </Box>
    )
  })

  // One run's live log, following its newest line while it runs.
  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const id = await read($, logRun)
    const { runs } = await read($, board)
    const run = runs.find(one => one.id === id)
    const now = (await $.clock.now()) / 1000
    const following = await read($, isFollowing)
    const width = Math.max(24, e.props.bodyColumns)
    if (run === undefined) {
      return (
        <Box flexDirection="column" width={width}>
          <Text dimColor>Run này không còn trên bảng (quá 24h hoặc đã bị dọn).</Text>
          <Button key="log-close" label="Đóng" hotkey="c" onPress={() => $.ui.close({ id: LOG_PANE })} />
        </Box>
      )
    }
    const look = lookOf(run.status)
    const isLive = run.status === 'running'
    const elapsed = isLive ? now - run.startedAt : (run.durationSeconds ?? 0)
    const lines = lastLines((await read($, logs))[run.id] ?? '', LOG_PANE_LINES)

    return (
      <Box flexDirection="column" width={width}>
        <Text wrap="truncate-end">
          <Text color={look.color}>{look.icon} </Text>
          <Text color={run.kind === 'agy' ? 'suggestion' : 'claude'}>{run.kind} </Text>
          <Text dimColor>{clock(elapsed)} · {isLive ? 'đang chạy' : look.word}</Text>
          {run.steps !== undefined && <Text dimColor> · {run.steps} bước</Text>}
          {run.tokens !== undefined && <Text dimColor> · {compact(run.tokens)} tok</Text>}
          {(run.errors ?? 0) > 0 && <Text color="error"> · {run.errors} lỗi</Text>}
        </Text>
        <Text bold wrap="truncate-end">{run.label}</Text>
        <Box gap={1}>
          <Button
            key="log-follow"
            label={following ? 'Theo dõi: bật' : 'Theo dõi: tắt'}
            hotkey="f"
            plain
            onPress={async () => {
              await update($, isFollowing, was => !was)
              if (!following) await $.ui.scroll({ in: LOG_PANE, to: 'end' }).catch(() => {})
            }}
          />
          {isLive && run.pid !== undefined && run.isDemo !== true && (
            <Button key="log-kill" label="Dừng" hotkey="k" plain onPress={async () => {
              await $.process.run(['kill', '-TERM', String(run.pid)])
              $.ui.toast(`Đã gửi lệnh dừng tới ${run.id}`)
            }} />
          )}
          <Button key="log-close" label="Đóng" hotkey="c" plain onPress={() => $.ui.close({ id: LOG_PANE })} />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {lines.length === 0 && <Text dimColor>Chưa có log cho run này.</Text>}
          {lines.map((line, i) => (
            <Text key={`line-${i}`} wrap="wrap" {...logLook(line)}>
              {line === '' ? ' ' : line}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })

  // The log pane closed: stop reading its run's log.
  on('ui.close', async ($, e, next) => {
    if (e.id === LOG_PANE) await update($, logRun, () => null)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Always above the prompt: this session's figures, then the agents while any run.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { runs } = await read($, board)
    // The wall clock at draw time; the board's own time only moves when it changes.
    const now = (await $.clock.now()) / 1000
    const me = await read($, sessionView)
    const skills = await read($, skillUses)
    const unchecked = pendingOf(await read($, reviews)).length
    const live = runs.filter(run => run.status === 'running')
    if (me === null && live.length === 0 && unchecked === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(30, e.props.bodyColumns)
    const pct = me?.percent ?? 0
    const [ctxOn, ctxOff] = bar(pct, 10)
    const errors = live.reduce((sum, run) => sum + (run.errors ?? 0), 0)
    const agentTokens = live.reduce((sum, run) => sum + (run.tokens ?? 0), 0)
    const limit = me?.limits.find(one => one.kind === 'five_hour') ?? me?.limits[0]
    const history = await read($, limitHistory)
    const turnStat = await read($, lastTurn)
    const look = limit?.kind === 'five_hour' ? outlook(history, now, limit.resetsAt) : undefined
    const isFull = pct >= CTX_COMPACT
    // Rows: the figures, then the last turn, then the agents, as the band has room.
    const rowsLeft = Math.max(0, e.props.maxRows - 1)
    const showTurn = turnStat !== null && rowsLeft > live.length
    const agentRows = Math.max(0, Math.min(3, rowsLeft - (showTurn ? 1 : 0)))

    return (
      <Box flexDirection="column" width={width}>
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            {me !== null && (
              <Text>
                <Text dimColor>ctx </Text>
                <Text color={heat(pct)}>{ctxOn}</Text>
                <Text dimColor>{ctxOff}</Text>
                <Text color={heat(pct)} bold> {me.percent === undefined ? '—' : `${me.isEstimate === true ? '~' : ''}${pct}%`}</Text>
                <Text dimColor>
                  {' '}{me.tokens === undefined ? '' : compact(me.tokens)}/{compact(me.window)}
                  {me.costUsd !== undefined ? ` · $${me.costUsd.toFixed(2)}` : ''}
                </Text>
                {limit !== undefined && (
                  <Text>
                    <Text color={heat(limit.percentUsed)}> · {limitName(limit.kind)} {me.isLimitsKept === true ? '~' : ''}{Math.round(limit.percentUsed)}%</Text>
                    <Text dimColor> ↻ {resetIn(limit.resetsAt, now)}</Text>
                    {look !== undefined && look.color !== 'subtle' && (
                      <Text color={look.color}>
                        {' '}
                        {sparkline(history, 4)} {look.text}
                      </Text>
                    )}
                  </Text>
                )}
                <Text dimColor> · skills </Text>
                {skills.length === 0 ? (
                  <Text dimColor>—</Text>
                ) : (
                  skills.slice(0, 3).map((one, i) => (
                    <Text>
                      {i > 0 ? ', ' : ''}
                      <Text color="suggestion">{one.name}</Text>
                      {one.count > 1 ? <Text dimColor>×{one.count}</Text> : ''}
                    </Text>
                  ))
                )}
              </Text>
            )}
            {live.length > 0 && (
              <Text>
                <Text dimColor> · </Text>
                <Text color="warning">⧉ {live.length} agent</Text>
                <Text dimColor> {compact(agentTokens)} tok</Text>
                {errors > 0 && <Text color="error"> {errors} lỗi</Text>}
              </Text>
            )}
            {unchecked > 0 && <Text color="warning"> · ⚑ {unchecked} agy chưa review</Text>}
          </Text>
          <Box gap={1}>
            {isFull && (
              <Button
                key="compact"
                label="Compact"
                hotkey="c"
                variant="primary"
                onPress={async () => {
                  $.ui.toast('Đang compact…')
                  const done = await $.session.compact()
                  $.ui.toast(done.skip === undefined ? 'Đã compact context' : `Không compact: ${done.skip}`)
                  void refreshSession($)
                }}
              />
            )}
            <Button key="open" label="Chi tiết" hotkey="a" plain onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
          </Box>
        </Box>
        {showTurn && turnStat !== null && (
          <Text wrap="truncate-end" dimColor>
            {'  lượt trước '}
            {turnLine(turnStat)}
          </Text>
        )}
        {live.slice(0, agentRows).map(run => (
          <Button key={`band-${run.id}`} plain onPress={() => openLog($, run)}>
            <Text wrap="truncate-end">
              <Text color="warning">{'  ● '}</Text>
              <Text color={run.kind === 'agy' ? 'suggestion' : 'claude'}>{run.kind} </Text>
              <Text dimColor>{clock(now - run.startedAt)} </Text>
              {short(run.label, 34)}
              {run.step !== undefined && <Text dimColor>{'  ▸ '}{run.step}</Text>}
            </Text>
          </Button>
        ))}
      </Box>
    )
  })
}
