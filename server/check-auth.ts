// Checks sign-in and run ownership against a real server and database. Run with: DATABASE_URL=... npm run check:auth
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { closeDb, db, dbEnabled } from './db/index.ts'
import { runs } from './db/schema.ts'
import { adopt } from './world.ts'

if (!dbEnabled()) throw new Error('Set DATABASE_URL to run this check.')
const PORT = 5199, BASE = `http://localhost:${PORT}`
const server = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), LLM: 'stub', BETTER_AUTH_URL: BASE },
  stdio: ['ignore', 'ignore', 'inherit'],
})
process.on('exit', () => server.kill())

const call = (path: string, cookie = '', init: RequestInit = {}) =>
  fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', origin: BASE, cookie, ...init.headers } })
async function guest() {
  const res = await call('/api/auth/sign-in/anonymous', '', { method: 'POST', body: '{}' })
  assert.equal(res.status, 200, 'guest sign-in')
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const me = await (await call('/api/me', cookie)).json()
  return { cookie, id: me.id as string, me }
}

for (let i = 0; ; i++) {
  if (await fetch(BASE + '/api/health').then(r => r.ok, () => false)) break
  if (i > 60) throw new Error('the server did not start')
  await new Promise(r => setTimeout(r, 500))
}

assert.deepEqual(await (await call('/api/auth-config')).json(), { enabled: true, guest: true, email: false, google: false })
assert.equal((await call('/api/sessions', '', { method: 'POST', body: '{"level":"bootcamp"}' })).status, 401, 'no session, no shift')
assert.equal((await call('/api/me')).status, 401)

const a = await guest(), b = await guest()
assert.notEqual(a.id, b.id)
assert.deepEqual([a.me.isAnonymous, a.me.role], [true, 'learner'])
await call('/api/auth/update-user', a.cookie, { method: 'POST', body: '{"role":"admin"}' })
assert.equal((await (await call('/api/me', a.cookie)).json()).role, 'learner', 'the client cannot set its role')

const started = await call('/api/sessions', a.cookie, { method: 'POST', body: '{"level":"bootcamp"}' })
assert.equal(started.status, 201)
const { id } = await started.json()
const [row] = await db().select().from(runs).where(eq(runs.id, id))
assert.equal(row.userId, a.id, 'the run belongs to whoever started it')

const routes: [string, RequestInit][] = [
  [`/api/sessions/${id}/file?path=package.json`, {}],
  [`/api/sessions/${id}/file`, { method: 'PUT', body: JSON.stringify({ path: 'notes.txt', text: 'hi' }) }],
  [`/api/sessions/${id}/act`, { method: 'POST', body: JSON.stringify({ type: 'seen', what: 'chan:team' }) }],
]
for (const [path, init] of routes) {
  assert.equal((await call(path, b.cookie, init)).status, 404, `someone else's ${init.method ?? 'GET'} ${path}`)
  assert.equal((await call(path, a.cookie, init)).status, 200, `the owner's ${init.method ?? 'GET'} ${path}`)
}
assert.equal((await call(`/api/sessions/${id}/events`, b.cookie)).status, 404, "someone else's stream")
const stream = new AbortController()
const events = await call(`/api/sessions/${id}/events`, a.cookie, { signal: stream.signal })
assert.equal(events.status, 200)
const first = new TextDecoder().decode((await events.body!.getReader().read()).value)
assert.ok(first.startsWith('event: snapshot'), 'the owner gets the stream by cookie')
stream.abort()
assert.equal(JSON.parse(first.split('data: ')[1]).world.userId, undefined, 'the owner stays off the world')

const mine = await (await call('/api/me/runs', a.cookie)).json()
assert.deepEqual([mine[0].id, mine[0].status, mine[0].level, mine[0].scenarioId], [id, 'active', 'bootcamp', 'ledgerly-day2'])
assert.deepEqual(await (await call('/api/me/runs', b.cookie)).json(), [])

const token = (await (await call('/api/auth/token', a.cookie)).json()).token as string
assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub, a.id, 'a JWT for the session')
assert.ok((await (await call('/api/auth/jwks')).json()).keys.length, 'a JWKS to check it against')

// What the anonymous plugin's onLinkAccount does when a guest signs up.
await adopt(a.id, b.id)
assert.equal((await db().select().from(runs).where(eq(runs.id, id)))[0].userId, b.id, 'linking hands the runs over')
assert.equal((await (await call('/api/me/runs', b.cookie)).json())[0].id, id)

assert.equal((await call('/api/auth/sign-out', a.cookie, { method: 'POST', body: '{}' })).status, 200)
assert.equal((await call('/api/me', a.cookie)).status, 401, 'signed out')

await closeDb()
console.log(`auth check passed · run ${id}`)
process.exit(0)
