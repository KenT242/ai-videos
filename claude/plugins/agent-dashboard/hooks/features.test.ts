import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Review, Run } from '../types'
import { looksDelegable } from './hint'
import { holdReason, isMine, isReviewCommand, mark, pendingOf, reviewedBy, syncReviews } from './review'
import { splitByAge, tailLines } from './runs'
import { report, summarize } from './usage'

const NOW = 1_800_000_000
const HOME = '/home/test'
const LOG = `${HOME}/.claude/agent-events.jsonl`

const agyRun = (over: Partial<Run>): Run => ({
  id: 'agy-1', kind: 'agy', label: 'fix foo', status: 'SUCCESS', startedAt: NOW + 1, endedAt: NOW + 50, cwd: '/w', ...over,
})

test('only runs this session launched are tracked for review', async () => {
  expect(isMine({ startedAt: NOW + 1 }, [NOW])).toBe(true)
  expect(isMine({ startedAt: NOW + 120 }, [NOW])).toBe(false)
  const list = syncReviews([], [agyRun({}), agyRun({ id: 'agy-other', startedAt: NOW - 500 }), agyRun({ id: 'agy-live', status: 'running' })], [NOW])
  expect(list.map(one => one.id)).toEqual(['agy-1'])
  expect(list[0]?.state).toBe('pending')
  // Synced again, nothing doubles.
  expect(syncReviews(list, [agyRun({})], [NOW])).toHaveLength(1)
})

test('a diff, a test run or a read inside the run folder counts as a review', async () => {
  const pending: Review[] = [{ id: 'agy-1', label: 'x', status: 'SUCCESS', cwd: '/w', endedAt: NOW, state: 'pending' }]
  expect(isReviewCommand('git -C /w diff --stat')).toBe(true)
  expect(isReviewCommand('cd /w && pytest -q')).toBe(true)
  expect(isReviewCommand('agy-tracked -p "run git diff"')).toBe(false)
  expect(isReviewCommand('ls -la')).toBe(false)
  expect(reviewedBy('Bash', { command: 'npm test' }, pending, NOW + 5)).toEqual(['agy-1'])
  expect(reviewedBy('Read', { file_path: '/w/src/a.ts' }, pending, NOW + 5)).toEqual(['agy-1'])
  expect(reviewedBy('Read', { file_path: '/elsewhere/a.ts' }, pending, NOW + 5)).toEqual([])
  // A check made before the run ended does not count.
  expect(reviewedBy('Bash', { command: 'git diff' }, pending, NOW - 30)).toEqual([])
  expect(pendingOf(mark(pending, ['agy-1'], 'reviewed'))).toHaveLength(0)
  expect(holdReason(pending)).toMatch(/1 lần chạy agy chưa được review/)
})

test('delegate hints: small jobs yes, design and risky jobs no', async () => {
  expect(looksDelegable('thêm test cho hàm parse_date trong utils.py')).toBe(true)
  expect(looksDelegable('rename getUser thành fetchUser trong api.ts')).toBe(true)
  expect(looksDelegable('fix typo trong README')).toBe(true)
  expect(looksDelegable('thiết kế lại kiến trúc module auth')).toBe(false)
  expect(looksDelegable('fix lỗi rồi commit và push lên main')).toBe(false)
  expect(looksDelegable('/agent-board demo')).toBe(false)
  expect(looksDelegable('tại sao test này fail?')).toBe(false)
})

test('usage folds turns and runs into days', async () => {
  const text = [
    { kind: 'claude', event: 'turn', seconds: 90, input_tokens: 1000, output_tokens: 200, cost_usd: 0.5, tools: 4, ts: NOW - 100 },
    { kind: 'claude', event: 'turn', seconds: 30, input_tokens: 500, output_tokens: 100, cost_usd: 0.25, tools: 1, ts: NOW - 50 },
    { id: 'agy-1', kind: 'agy', event: 'start', ts: NOW - 400 },
    { id: 'agy-1', event: 'end', status: 'SUCCESS', duration_seconds: 120, usage: { total_tokens: 3000 }, ts: NOW - 280 },
    { id: 'agy-2', kind: 'agy', event: 'start', ts: NOW - 300 },
    { id: 'agy-2', event: 'end', status: 'EMPTY', duration_seconds: 600, usage: { input_tokens: 10, output_tokens: 5 }, ts: NOW - 10 },
    { id: 'sub-1', kind: 'subagent', event: 'end', status: 'done', ts: NOW - 5 },
    { kind: 'claude', event: 'turn', seconds: 999, ts: NOW - 30 * 86_400 },
  ].map(one => JSON.stringify(one)).join('\n')
  const rows = summarize(text, NOW, 7)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ turns: 2, turnSeconds: 120, inputTokens: 1500, costUsd: 0.75, agyRuns: 2, agyFailed: 1, agyTokens: 3015, subagents: 1 })
  const md = report(rows, 7)
  expect(md).toMatch(/\| \*\*Tổng\*\* \| 2 \|/)
  expect(md).toMatch(/agy chiếm 50%/)
  expect(report([], 7)).toMatch(/Không có dữ liệu/)
})

test('rotation keeps recent lines and cuts at whole lines', async () => {
  const text = [
    JSON.stringify({ id: 'a', event: 'start', ts: NOW - 40 * 86_400 }),
    'not json',
    JSON.stringify({ id: 'b', event: 'start', ts: NOW - 86_400 }),
  ].join('\n')
  const { keep, old } = splitByAge(text, NOW - 30 * 86_400)
  expect(old).toHaveLength(1)
  expect(keep).toHaveLength(2)
  expect(tailLines('aaa\nbbb\nccc\n', 6)).toBe('ccc\n')
  expect(tailLines('short', 100)).toBe('short')
})

// A file system in memory and a process runner that does nothing, beneath the plugin.
function fakeMachine(on: On, files: Map<string, string>) {
  on('fs.read', async (_$, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.write', async (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', async (_$, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } as never }
  })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } as never }))
  on('ui.status', async () => ({ value: undefined }))
  on('tool.call', async () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('classic.PostToolUse', async () => ({}))
  on('classic.Stop', async () => ({}))
}

test('review gate: holds the turn once for an unchecked agy run, a diff clears it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME })
  const files = new Map<string, string>()
  fakeMachine(on, files)

  await $.tool.call({ tool: 'Bash', command: 'agy-tracked -p "fix foo in /w/a.py" --print-timeout 5m' })
  const note = await $.classic.PostToolUse({
    tool_name: 'Bash', tool_input: { command: 'agy-tracked -p "fix foo"' }, tool_response: {}, tool_use_id: 't1',
  } as never)
  expect(note.additionalContext?.join(' ')).toMatch(/review gate/)

  files.set(LOG, [
    { id: 'agy-1', kind: 'agy', event: 'start', task: 'fix foo', cwd: '/w', ts: NOW + 1 },
    { id: 'agy-1', kind: 'agy', event: 'end', status: 'SUCCESS', duration_seconds: 49, ts: NOW + 50 },
  ].map(one => JSON.stringify(one)).join('\n'))
  await clock.advance(60_000)

  const held = await $.classic.Stop({ stop_hook_active: false } as never)
  expect(held.block).toMatch(/agy-1/)
  // Held once per run: the next stop goes through.
  const again = await $.classic.Stop({ stop_hook_active: true } as never)
  expect(again.block).toBeUndefined()

  const band = async () => $.ui.mount({
    plugin: 'agent-dashboard', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  })
  const top = await band()
  expect(await top.find({ type: 'Text', text: /1 agy chưa review/ })).toBeDefined()
  await top.unmount()

  const pane = async () => $.ui.mount({
    plugin: 'agent-dashboard', surface: 'terminal', component: 'Pane', requestId: 'agent-dashboard',
    props: { title: 'Agents', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  let ui = await pane()
  expect(await ui.find({ type: 'Text', text: /1 chưa review/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'git -C /w diff' })
  ui = await pane()
  expect(await ui.find({ type: 'Text', text: /chưa review/ })).toBeUndefined()
  await ui.unmount()
})

test('/usage-report reads the log and answers a table', async ($, on) => {
  mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME })
  const files = new Map<string, string>()
  fakeMachine(on, files)
  files.set(LOG, JSON.stringify({ kind: 'claude', event: 'turn', seconds: 75, input_tokens: 2000, output_tokens: 300, cost_usd: 0.4, tools: 3, ts: NOW - 60 }))
  const answer = await $.command.run({ command: 'usage-report', args: '3' } as never)
  expect(answer.text).toMatch(/Usage 3 ngày qua/)
  expect(answer.text).toMatch(/\| 1 \| 1m \| 2k\/300 \| \$0\.40 \|/)
})
