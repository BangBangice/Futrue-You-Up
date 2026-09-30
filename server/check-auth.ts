// Checks sign-in and run ownership against a real server and database. Run with: DATABASE_URL=... npm run check:auth
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { closeDb, db, dbEnabled } from './db/index.ts'
import { runs, users } from './db/schema.ts'
import { googleEnabled } from './auth.ts'
import { mailScope, send } from './mail.ts'
import { adopt } from './world.ts'

if (!dbEnabled()) throw new Error('Set DATABASE_URL to run this check.')
const PORT = 5199, BASE = `http://localhost:${PORT}`
// No mail service, so the server prints each email, links included, where this check can read them.
const env = { ...process.env }
for (const k of ['RESEND_API_KEY', 'MAILPIT_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NODE_ENV']) delete env[k]
const server = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', 'server/index.ts'], {
  env: { ...env, PORT: String(PORT), LLM: 'stub', BETTER_AUTH_URL: BASE },
  stdio: ['ignore', 'pipe', 'inherit'],
})
process.on('exit', () => server.kill())
let printed = ''
server.stdout!.on('data', d => { printed += d })
async function mailTo(email: string) {
  for (let i = 0; i < 40; i++) {
    const m = printed.match(new RegExp(`\\[mail\\] to ${email.replace(/[.+]/g, '\\$&')} · [^\\n]*\\n[^]*?: (http\\S+)`))
    if (m) { printed = printed.replace(m[0], ''); return m[1] }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`no email to ${email}`)
}

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

assert.deepEqual(await (await call('/api/auth-config')).json(), { enabled: true, guest: true, email: true, google: false })
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
// A guest gets a made-up name, and plays the shift under it.
assert.match(a.me.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/, 'a guest is named like "Happy Mango"')
const cast = (row.world as { cast: Record<string, { name: string }>; player: string })
assert.equal(cast.cast[cast.player].name, a.me.name, 'the player is cast with the account name')

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

// Email accounts: nobody gets in until the address is confirmed.
const cookieOf = (res: Response) => res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
const post = (path: string, body: object, cookie = '') => call(path, cookie, { method: 'POST', body: JSON.stringify(body) })
const signIn = (email: string, password: string) => post('/api/auth/sign-in/email', { email, password })
const follow = (link: string, cookie = '') => call(link.slice(BASE.length), cookie, { redirect: 'manual' })
const PASSWORD = 'correct horse 1', tag = Date.now().toString(36)
const register = (email: string, cookie = '') => post('/api/auth/sign-up/email', { name: 'Sam', email, password: PASSWORD, callbackURL: '/' }, cookie)
async function confirm(email: string, cookie = '') {
  const res = await follow(await mailTo(email), cookie)
  assert.equal(res.status, 302, 'the confirmation link redirects')
  assert.equal(res.headers.get('location'), '/', 'back to the app')
  const session = cookieOf(res)
  assert.ok(session.includes('session_token'), 'confirming signs you in')
  return session
}

const sam = `sam-${tag}@example.com`
const signedUp = await register(sam)
assert.equal(signedUp.status, 200, 'sign-up')
assert.ok(!cookieOf(signedUp).includes('session_token'), 'no session before the email is confirmed')
await mailTo(sam)
const blocked = await signIn(sam, PASSWORD)
assert.equal(blocked.status, 403, 'sign-in waits for the confirmation')
assert.equal((await blocked.json()).code, 'EMAIL_NOT_VERIFIED')
const samCookie = await confirm(sam)
assert.deepEqual(Object.values(await (await call('/api/me', samCookie)).json()).slice(1), ['Sam', false, 'learner'])
assert.equal((await signIn(sam, PASSWORD)).status, 200, 'signs in once confirmed')

// A guest who registers keeps their shifts, whichever browser opens the confirmation link.
for (const sameBrowser of [false, true]) {
  const g = await guest()
  const run = (await (await call('/api/sessions', g.cookie, { method: 'POST', body: '{"level":"bootcamp"}' })).json()).id
  const email = `guest-${sameBrowser}-${tag}@example.com`
  assert.equal((await register(email, g.cookie)).status, 200)
  const cookie = await confirm(email, sameBrowser ? g.cookie : '')
  const now = await (await call('/api/me', cookie)).json()
  assert.equal(now.isAnonymous, false)
  assert.deepEqual((await (await call('/api/me/runs', cookie)).json()).map((r: { id: string }) => r.id), [run], `the guest's run moved (same browser: ${sameBrowser})`)
  assert.equal((await db().select().from(runs).where(eq(runs.id, run)))[0].userId, now.id)
  if (sameBrowser) assert.equal((await db().select().from(users).where(eq(users.id, g.id))).length, 0, 'the linked guest is gone')
}

// Password reset: the link lands on the app's reset form with a token, and old sessions end.
assert.equal((await post('/api/auth/request-password-reset', { email: sam, redirectTo: '/reset-password' })).status, 200)
const toForm = await follow(await mailTo(sam))
assert.equal(toForm.status, 302)
const landing = new URL(toForm.headers.get('location')!, BASE)
const resetToken = landing.searchParams.get('token')
assert.ok(resetToken && landing.pathname === '/reset-password', 'the reset link opens the reset form')
assert.equal((await post('/api/auth/reset-password', { newPassword: 'battery staple 2', token: resetToken })).status, 200)
assert.equal((await post('/api/auth/reset-password', { newPassword: 'battery staple 3', token: resetToken })).status, 400, 'a reset link works once')
assert.equal((await call('/api/me', samCookie)).status, 401, 'resetting signs out everywhere')
assert.equal((await signIn(sam, PASSWORD)).status, 401, 'the old password is gone')
assert.equal((await signIn(sam, 'battery staple 2')).status, 200)

// A mail service that fails is reported, not swallowed.
process.env.MAILPIT_URL = 'http://127.0.0.1:9'
const scope: { failed?: boolean } = {}
const letter = { to: 'x@example.com', subject: 'check', text: 'check', html: 'check' }
await mailScope.run(scope, () => send(letter))
assert.ok(scope.failed, 'a failed send marks the request')
await assert.rejects(send(letter), 'outside a request a failed send throws')

// Google can only be checked this far: it is offered only when both of its variables are set.
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) delete process.env[k]
assert.equal(googleEnabled(), false)
assert.notEqual((await post('/api/auth/sign-in/social', { provider: 'google' })).status, 200, 'no Google without its keys')
Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })
assert.equal(googleEnabled(), true)

await closeDb()
console.log(`auth check passed · run ${id}`)
process.exit(0)
