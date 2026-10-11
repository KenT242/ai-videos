import { expect, mock, test } from 'claude-code/testing'

import { bar, compact, demoLog, demoRuns, describeRow, fold, lastLines, logLook, readLiveLog, resetIn, toSessionView } from './register'

const NOW = 1_800_000_000

test('folds start, progress and end into one run per id, newest first', async () => {
  const text = [
    { id: 'agy-1', kind: 'agy', event: 'start', task: 'fix foo', cwd: '/w', pid: 42, ts: NOW - 100 },
    { id: 'agy-1', event: 'progress', usage: { input_tokens: 800, output_tokens: 200 }, context_pct: 12, ts: NOW - 80 },
    { id: 'agy-1', kind: 'agy', event: 'end', status: 'SUCCESS', duration_seconds: 42, num_turns: 3,
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 9000 }, ts: NOW - 58 },
    { id: 'agy-2', kind: 'agy', event: 'start', task: 'live', timeout_seconds: 600, ts: NOW - 30 },
    { id: 'agy-2', event: 'progress', tokens: 5000, step: 'grep x', ts: NOW - 5 },
  ]
    .map(ev => JSON.stringify(ev))
    .concat(['not json', ''])
    .join('\n')
  const runs = fold(text, NOW)
  expect(runs.map(run => [run.id, run.status])).toEqual([
    ['agy-2', 'running'],
    ['agy-1', 'SUCCESS'],
  ])
  expect(runs[0]?.tokens).toBe(5000)
  expect(runs[0]?.step).toBe('grep x')
  expect(runs[0]?.timeoutSeconds).toBe(600)
  expect(runs[1]?.tokens).toBe(1500)
  expect(runs[1]?.contextPct).toBe(12)
  expect(runs[1]?.pid).toBe(42)
  expect(runs[1]?.step).toBeUndefined()
})

test('reads the current step and counts from a live log', async () => {
  const live = readLiveLog('▶ agy x\n  task: t\n▸ view_file {"a":1}\ntext\n  ✗ run: FAILED\n▸ grep {"p":"q"}\n')
  expect(live).toEqual({ step: 'grep {"p":"q"}', steps: 2, errors: 1 })
})

test('demo runs move with the clock', async () => {
  const early = demoRuns(NOW, NOW)
  const later = demoRuns(NOW + 30, NOW)
  expect(early.filter(run => run.status === 'running').length).toBe(3)
  expect((later[0]?.tokens ?? 0) > (early[0]?.tokens ?? 0)).toBe(true)
})

test('formats bars and token counts', async () => {
  expect(bar(62)).toEqual(['██████', '░░░░'])
  expect(compact(342_591)).toBe('343k')
  expect(compact(1_250_000)).toBe('1.3M')
})

test('the pane draws empty and with demo runs', async ($, on) => {
  mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME: '/home/test' })
  const props = {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  } as const
  const ui = await $.ui.mount({ plugin: 'agent-dashboard', surface: 'terminal', component: 'Pane', requestId: 'agent-dashboard', props })
  expect(await ui.find({ type: 'Text', text: /Chưa có lần chạy/ })).toBeDefined()
  await ui.unmount()

  const shown = await $.ui.mount({ plugin: 'agent-dashboard', surface: 'terminal', component: 'Pane', requestId: 'agent-dashboard', props })
  await shown.press({ key: 'demo' })
  expect(await shown.find({ type: 'Text', text: /ĐANG CHẠY/ })).toBeDefined()
  await shown.press({ key: 'row-demo-agy-1' })
  expect(await shown.find({ key: 'kill-demo-agy-1' })).toBeDefined()
  await shown.unmount()
})

test('an open card shows its live log, and Xem log opens the log pane on it', async ($, on) => {
  mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME: '/home/test' })
  const props = {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  } as const
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(`${e.id}: ${e.title}`)
    return { value: { isPlaced: true } }
  })
  on('ui.scroll', () => ({}))
  const board = await $.ui.mount({ plugin: 'agent-dashboard', surface: 'terminal', component: 'Pane', requestId: 'agent-dashboard', props })
  await board.press({ key: 'demo' })
  await board.press({ key: 'row-demo-agy-1' })
  expect(await board.find({ type: 'Text', text: /log \(trực tiếp\)/ })).toBeDefined()
  await board.press({ key: 'log-demo-agy-1' })
  expect(opened.some(one => one.startsWith('agent-dashboard-log: Log · agy · Blender: dựng cảnh 2D'))).toBe(true)
  await board.unmount()

  const log = await $.ui.mount({
    plugin: 'agent-dashboard', surface: 'terminal', component: 'Pane', requestId: 'agent-dashboard-log',
    props: { ...props, title: 'Log' },
  })
  expect(await log.find({ type: 'Text', text: /Blender: dựng cảnh 2D/ })).toBeDefined()
  expect(await log.find({ type: 'Text', text: /^▸ get_scene_info/ })).toBeDefined()
  expect(await log.find({ key: 'log-follow' })).toBeDefined()
  await log.unmount()
})

test('log lines: the last ones, styled by kind', async () => {
  expect(lastLines('a\nb\nc\n\n', 2)).toEqual(['b', 'c'])
  expect(lastLines('  \n', 5)).toEqual([])
  expect(logLook('▸ grep {}')).toEqual({ color: 'suggestion' })
  expect(logLook('  ✗ run: FAILED')).toEqual({ color: 'error' })
  expect(logLook('■ END SUCCESS · 3s')).toEqual({ bold: true })
  const run = demoRuns(NOW, NOW)[0]!
  expect(demoLog(run).split('\n').filter(line => line.startsWith('▸ ')).length).toBe(run.steps)
})

test('the session view keeps used categories, largest first', async () => {
  const view = toSessionView(
    {
      startedAt: 0,
      context: {
        tokens: 62_000,
        window: 200_000,
        percent: 31,
        breakdown: {
          categories: [
            { name: 'Free space', tokens: 100_000, color: 'inactive', isDeferred: false, kind: 'free' },
            { name: 'System tools', tokens: 12_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
            { name: 'Messages', tokens: 38_000, color: 'permission', isDeferred: false, kind: 'used' },
          ],
          model: 'claude-opus-5-5',
          autoCompactThreshold: 167_000,
          skills: { includedSkills: 31, tokens: 4200 },
        },
      },
      rateLimits: [{ kind: 'five_hour', percentUsed: 34 }],
      cost: { usd: 1.84 },
    } as never,
    'fallback',
    12,
  )
  expect(view.model).toBe('claude-opus-5-5')
  expect(view.categories.map(row => row.name)).toEqual(['Messages', 'System tools'])
  expect(view.autoCompactAt).toBe(167_000)
  expect(view.skillsListed).toBe(31)
  expect(view.costUsd).toBe(1.84)
})

test('before the first reply the session view falls back to the /context estimate', async () => {
  const view = toSessionView(
    {
      startedAt: 0,
      context: {
        window: 200_000,
        breakdown: { categories: [], model: 'claude-opus-5-5', totalTokens: 24_000, percentage: 12.4 },
      },
      rateLimits: [],
    } as never,
    'fallback',
    0,
  )
  expect(view.tokens).toBe(24_000)
  expect(view.percent).toBe(12)
  expect(view.isEstimate).toBe(true)
})

test('the band above the prompt shows the running agents', async ($, on) => {
  mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME: '/home/test' })
  const pane = await $.ui.mount({
    plugin: 'agent-dashboard', surface: 'terminal', component: 'Pane', requestId: 'agent-dashboard',
    props: { title: 'Agents', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  await pane.press({ key: 'demo' })
  await pane.unmount()
  const band = await $.ui.mount({
    plugin: 'agent-dashboard', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  })
  expect(await band.find({ type: 'Text', text: /3 agent/ })).toBeDefined()
  expect(await band.find({ key: 'open' })).toBeDefined()
  await band.unmount()
})

test('the band shows the 5h trend and when the window runs out', async ($, on) => {
  mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME: '/home/test' })
  const view = toSessionView(
    {
      startedAt: 0,
      context: { tokens: 40_000, window: 200_000, percent: 20 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 60, resetsAt: new Date((NOW + 3 * 3600) * 1000).toISOString() }],
    } as never,
    'fallback',
    0,
  )
  const history = [30, 40, 50, 60].map((pct, i) => ({ t: NOW - 3600 + i * 1200, pct }))
  on('state.get', { plugin: 'agent-dashboard', key: 'session' }, async () => ({ value: { value: view, version: 1 } }))
  on('state.get', { plugin: 'agent-dashboard', key: 'limitHistory' }, async () => ({ value: { value: history, version: 1 } }))
  const band = await $.ui.mount({
    plugin: 'agent-dashboard', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 160, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  })
  expect(await band.find({ type: 'Text', text: /▃▄▅▅ \+30%\/h · hết sau ~1h20m/ })).toBeDefined()
  await band.unmount()
})

test('counts down to a rate-limit reset', async () => {
  const at = new Date((NOW + 72 * 60) * 1000).toISOString()
  expect(resetIn(at, NOW)).toBe('1h12m')
  expect(resetIn(new Date((NOW + 59) * 1000).toISOString(), NOW)).toBe('1m')
  expect(resetIn(new Date((NOW - 5) * 1000).toISOString(), NOW)).toBe('sắp reset')
  expect(resetIn(undefined, NOW)).toBe('—')
  expect(resetIn(String(NOW + 3600), NOW)).toBe('1h00m')
  expect(resetIn((NOW + 600) * 1000, NOW)).toBe('10m')
})

test('describes a subagent row as readable lines', async () => {
  expect(
    describeRow([
      { type: 'text', text: 'Looking at the parser.' },
      { type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'parse' } },
    ]),
  ).toBe('Looking at the parser.\n▸ Grep {"pattern":"parse"}')
  expect(describeRow([{ type: 'tool_result', tool_use_id: 't1', content: 'src/a.c:12' }])).toBe('  ↳ src/a.c:12')
})
