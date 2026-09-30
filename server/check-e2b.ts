// A live smoke test of running player code in E2B (e2b.ts). Costs a few sandbox-seconds. Run with: npm run check:e2b
// Needs E2B_API_KEY (in .env or the environment). Without one it says so and passes, so it is safe to run anywhere.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useE2B, Workspace } from './sandbox.ts'
import type { Runner } from './sandbox.ts'
import type { TermLine } from '../shared/types.ts'

if (!process.env.E2B_API_KEY) {
  console.log('check:e2b skipped: no E2B_API_KEY in the environment or .env')
  process.exit(0)
}
delete process.env.SANDBOX
assert.ok(useE2B())

const person = (name: string) => ({ name, init: name[0], color: '#888', email: `${name.toLowerCase()}@example.com`, title: 'Engineer' })
const dir = await mkdtemp(join(tmpdir(), 'larp-e2b-'))
const ws = await Workspace.open(dir, person('Maya'), { repo: 'ledgerly-api', author: person('Daniel') })
const runner = (ws as unknown as { runner: Runner }).runner
const timed = async <T>(label: string, fn: () => Promise<T>) => {
  const t = Date.now()
  const out = await fn()
  console.log(`${label}: ${Date.now() - t} ms`)
  return out
}

try {
  // First command: makes the sandbox, copies the workspace in, runs one test file. Output arrives line by line.
  const lines: { at: number; line: TermLine }[] = []
  const emit = (line: TermLine) => lines.push({ at: Date.now(), line })
  const first = await timed('first command (cold: new sandbox)', () => ws.exec(['npm', 'test', '--', 'src/auth/jwt.test.ts'], emit))
  assert.equal(first, 0, lines.map(l => l.line.t).join('\n'))
  assert.ok(lines.some(l => l.line.c === 'ok'), 'test results stream back as lines')

  // The same again: the sandbox is reused and nothing needs copying.
  assert.equal(await timed('warm command (same test file)', () => ws.exec(['npm', 'test', '--', 'src/auth/jwt.test.ts'], () => {})), 0)

  // The whole Ledgerly suite, after an edit: only the changed file is copied.
  await ws.write('src/extra.test.ts', "import test from 'node:test'\ntest('an edit reaches the sandbox', () => {})\n")
  const all: string[] = []
  await timed('npm test (whole suite, one file changed)', () => ws.exec(['npm', 'test'], l => all.push(l.t)))
  assert.ok(all.some(l => l.includes('an edit reaches the sandbox')), all.join('\n'))

  // A deleted file is gone in the sandbox too.
  await ws.exec(['rm', 'src/extra.test.ts'], () => {})
  const after: string[] = []
  await ws.exec(['npm', 'test'], l => after.push(l.t))
  assert.ok(!after.some(l => l.includes('an edit reaches the sandbox')), 'a deleted test file no longer runs')

  // The hidden production checks: the template ships with the LED-214 bug and nothing else.
  const v = await timed('hidden checks', () => ws.accept(['password_login', 'dashboard_fallthrough', 'sso_after_refresh', 'api_key', 'rejects_expired', 'rejects_missing', 'rejects_tampered']))
  assert.equal(v.build, 'ok', v.error ?? 'broken build')
  assert.deepEqual(v.checks.filter(c => !c.ok).map(c => c.id), ['sso_after_refresh'])

  // No way out to the internet, even for code that gets past the preload in sandbox.ts (this probe runs without it).
  let probe = ''
  const net = await runner.node(['-e', "fetch('https://example.com', { signal: AbortSignal.timeout(5000) }).then(r => console.log('REACHED', r.status), e => console.log('BLOCKED', e.cause?.code ?? e.message))"], t => { probe += t })
  await net.done
  console.log(`network from the sandbox: ${probe.trim()}`)
  assert.ok(probe.includes('BLOCKED'), 'the sandbox can reach the internet')

  // Stopping a command stops it.
  let ticks = 0
  const loop = await runner.node(['-e', 'setInterval(() => console.log("tick"), 100)'], t => { ticks += t.split('tick').length - 1 })
  await new Promise(r => setTimeout(r, 1500))
  assert.ok(ticks > 0, 'a long-running command streams while it runs')
  loop.kill()
  await timed('kill', () => loop.done)

  // Ending the shift kills the sandbox. The next run makes a new one, as it would after an expiry.
  await timed('close (kill sandbox)', () => ws.close())
  assert.equal(await timed('command after close (new sandbox)', () => ws.exec(['npm', 'test', '--', 'src/auth/jwt.test.ts'], () => {})), 0)
  console.log('e2b check passed')
} finally {
  await ws.close()
  await rm(dir, { recursive: true, force: true })
}
