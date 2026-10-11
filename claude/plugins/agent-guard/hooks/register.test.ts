import { expect, test } from 'claude-code/testing'

test('the hook refuses a catastrophic rm before it runs', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  const called = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })
  expect(ran).toBe(false)
  expect(called.isError).toBe(true)
  expect(String(called.text)).toMatch(/agent-guard/)
})

test('an ordinary command reaches the tool', async ($, on) => {
  let ran = false
  on('tool.call', { tool: 'Bash' }, () => {
    ran = true
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(ran).toBe(true)
})
