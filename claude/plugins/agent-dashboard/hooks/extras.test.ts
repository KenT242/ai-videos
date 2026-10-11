import { expect, test } from 'claude-code/testing'

import { addSample, delegatePrompt, forecast, isSession, parseTell, sparkline, toPeers } from './extras'

const NOW = 1_800_000_000

test('samples start over when the 5h window resets', async () => {
  let history = addSample([], { t: NOW, pct: 40 })
  history = addSample(history, { t: NOW + 600, pct: 50 })
  expect(history.length).toBe(2)
  expect(addSample(history, { t: NOW + 700, pct: 50 }).length).toBe(2)
  expect(addSample(history, { t: NOW + 900, pct: 3 })).toEqual([{ t: NOW + 900, pct: 3 }])
})

test('forecasts whether the window fills before it resets', async () => {
  const history = [
    { t: NOW - 1800, pct: 40 },
    { t: NOW, pct: 50 },
  ]
  // 10% per 30 min: 50% left takes 2.5h.
  const soon = forecast(history, NOW, NOW + 4 * 3600)
  expect(soon.kind).toBe('rate')
  if (soon.kind === 'rate') {
    expect(Math.round(soon.perHour)).toBe(20)
    expect(Math.round(soon.secondsToFull / 60)).toBe(150)
    expect(soon.isBeforeReset).toBe(true)
  }
  const later = forecast(history, NOW, NOW + 3600)
  expect(later.kind === 'rate' && later.isBeforeReset).toBe(false)
  expect(forecast([{ t: NOW, pct: 50 }], NOW, undefined).kind).toBe('measuring')
  expect(forecast([{ t: NOW - 900, pct: 50 }, { t: NOW, pct: 50 }], NOW, undefined).kind).toBe('steady')
})

test('draws a sparkline of the readings', async () => {
  expect(sparkline([{ t: 1, pct: 0 }, { t: 2, pct: 50 }, { t: 3, pct: 100 }])).toBe('▁▅█')
})

test('reads ListAgents sections into peers', async () => {
  const peers = toPeers({
    sections: [
      { kind: 'sessions', total: 2, rows: [{ name: 'blender', status: 'idle' }, { name: '' }] },
      { kind: 'agents', total: 1, rows: [{ name: 'explore-1', type: 'Explore' }] },
    ],
  })
  expect(peers.map(peer => peer.name)).toEqual(['blender', 'explore-1'])
  expect(peers.filter(isSession).map(peer => peer.name)).toEqual(['blender'])
})

test('parses /tell arguments', async () => {
  expect(parseTell('blender chạy lại test đi')).toEqual({ to: 'blender', text: 'chạy lại test đi' })
  expect(parseTell('"my app" hi')).toEqual({ to: 'my app', text: 'hi' })
  expect(parseTell('onlyname')).toBeUndefined()
})

test('the delegate prompt carries the task and the review steps', async () => {
  const text = delegatePrompt('thêm test cho parse_date')
  expect(text.includes('> thêm test cho parse_date')).toBe(true)
  expect(text.includes('agy-tracked')).toBe(true)
})
