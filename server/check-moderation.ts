// Checks moderation: reporting, the admin routes (a 404 for anyone else), unpublishing and banning. Run with: DATABASE_URL=... npm run check:db
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { and, eq, inArray } from 'drizzle-orm'
import { closeDb, db, dbEnabled, migrateDb } from './db/index.ts'
import { lessonReports, scenarioVersions, scenarios, sessions, users } from './db/schema.ts'
import { auth } from './auth.ts'
import { lessonsApi, playable } from './authoring.ts'
import { lessonTags, listLessons } from './lessons.ts'
import { REPORTS_PER_DAY, adminApi, removed, reportRoute } from './moderation.ts'
import { api, errors, notFound } from './routes.ts'
import { scenarioFile } from './scenarios.ts'

process.env.LLM = 'stub'
process.env.BETTER_AUTH_SECRET ??= 'check-moderation-secret-not-for-production'
process.env.BETTER_AUTH_URL ??= 'http://localhost:5183'
if (!dbEnabled()) throw new Error('Set DATABASE_URL to run this check.')
await migrateDb()

// The routes behind a stand-in for sign-in: x-user names the caller, x-role their role. The real API is mounted too, for
// /api/scenario, which is open before sign-in.
const app = express()
app.use(express.json())
app.use('/api', api)
app.use((req: Request, res: Response, next: NextFunction) => { res.locals.me = { id: req.headers['x-user'], role: req.headers['x-role'] ?? 'learner' }; next() })
app.post('/lessons/:id/report', reportRoute)
app.use('/admin', adminApi)
app.use('/my/lessons', lessonsApi)
app.use(notFound, errors)
const server = app.listen(0)
const base = `http://localhost:${(server.address() as AddressInfo).port}`
const call = async (user: string, method: string, path: string, body?: unknown, role?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-user': user, ...(role && { 'x-role': role }) }
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text }
}

const tag = `moderation-${Date.now()}`
const [admin, alice, bob, guest, spammer] = ['admin', 'alice', 'bob', 'guest', 'spammer'].map(n => `${tag}-${n}`)
await db().insert(users).values([
  { id: admin, name: 'Admin', email: `${admin}@example.test`, emailVerified: true, role: 'admin' },
  { id: alice, name: 'Alice Author', email: `${alice}@example.test`, emailVerified: true },
  { id: bob, name: 'Bob Player', email: `${bob}@example.test`, emailVerified: true },
  { id: guest, name: 'Happy Mango', email: `${guest}@example.test`, isAnonymous: true },
  { id: spammer, name: 'Spammer', email: `${spammer}@example.test`, emailVerified: true },
])
const spec = { ...structuredClone(scenarioFile('ledgerly-day2')!), tags: [tag] }
const lessons = [`${tag}-one`, `${tag}-two`, `${tag}-private`]
await db().insert(scenarios).values(lessons.map(id => ({ id, title: id, tags: [tag], authorId: alice, visibility: id.endsWith('private') ? 'private' as const : 'public' as const })))
await db().insert(scenarioVersions).values(lessons.map(id => ({ scenarioId: id, version: 1, spec: { ...spec, id }, status: 'published' as const })))
const [one, two, priv] = lessons
const listed = async () => (await listLessons({ tag })).map(l => l.id).sort()
const tagCount = async () => (await lessonTags()).find(t => t.tag === tag)?.count ?? 0

try {
  assert.deepEqual(await listed(), [one, two])
  assert.equal(await tagCount(), 2)

  // Reporting: any signed-in user, guests included. One open report each per lesson.
  assert.equal((await call(bob, 'POST', `/lessons/${one}/report`, { reason: 'rude' })).status, 400, 'an unknown reason')
  assert.equal((await call(bob, 'POST', `/lessons/${one}/report`, { reason: 'other', note: 'x'.repeat(501) })).status, 400, 'a note over 500 characters')
  assert.equal((await call(bob, 'POST', `/lessons/${priv}/report`, { reason: 'spam' })).status, 404, "a private lesson isn't there to report")
  assert.equal((await call(bob, 'POST', `/lessons/${one}/report`, { reason: 'offensive', note: '  Slurs in the intro.  ' })).status, 201)
  const again = await call(bob, 'POST', `/lessons/${one}/report`, { reason: 'spam' })
  assert.equal(again.status, 409, 'a second open report on the same lesson')
  assert.match(again.body.error, /already reported/)
  assert.equal((await call(guest, 'POST', `/lessons/${one}/report`, { reason: 'broken' })).status, 201, 'a guest may report')
  assert.equal((await call(bob, 'POST', `/lessons/${two}/report`, { reason: 'spam' })).status, 201)

  // At most REPORTS_PER_DAY a day each.
  await db().insert(lessonReports).values(Array.from({ length: REPORTS_PER_DAY }, () => ({ scenarioId: two, reporterId: spammer, reason: 'spam' as const, status: 'dismissed' as const })))
  assert.equal((await call(spammer, 'POST', `/lessons/${one}/report`, { reason: 'spam' })).status, 429, 'the daily limit')

  // The admin routes are a 404 for anyone else, like a path that doesn't exist.
  const nothing = await call(bob, 'GET', '/admin/no-such-route')
  assert.deepEqual([nothing.status, nothing.body], [404, { error: 'Not found.' }])
  for (const [m, p] of [['GET', '/admin/reports'], ['POST', `/admin/lessons/${one}/unpublish`], ['POST', `/admin/users/${alice}/ban`]] as const) {
    const body = m === 'GET' ? undefined : { reason: 'x' }
    const r = await call(bob, m, p, body)
    assert.deepEqual([r.status, r.body], [404, nothing.body], `${m} ${p} for a non-admin, like a path that doesn't exist`)
    assert.equal((await call(guest, m, p, body)).status, 404)
  }

  // The queue: grouped by lesson, the most reported first.
  const q = await call(admin, 'GET', '/admin/reports', undefined, 'admin')
  assert.equal(q.status, 200)
  const mine = q.body.filter((i: { lesson: { id: string } }) => lessons.includes(i.lesson.id))
  assert.deepEqual(mine.map((i: { lesson: { id: string }; count: number }) => [i.lesson.id, i.count]), [[one, 2], [two, 1]])
  assert.deepEqual(mine[0].lesson.author, { id: alice, name: 'Alice Author', banned: false })
  assert.deepEqual(mine[0].reports.map((r: { reason: string }) => r.reason).sort(), ['broken', 'offensive'])
  assert.equal(mine[0].reports.find((r: { reason: string }) => r.reason === 'offensive').note, 'Slurs in the intro.')

  // Dismissing a report closes it, and then its reporter may report again.
  const twoReport = mine[1].reports[0].id
  assert.equal((await call(admin, 'POST', `/admin/reports/${twoReport}`, { action: 'dismiss' }, 'admin')).status, 200)
  assert.equal((await call(admin, 'POST', `/admin/reports/${twoReport}`, { action: 'dismiss' }, 'admin')).status, 404, 'already closed')
  const [closed] = await db().select().from(lessonReports).where(eq(lessonReports.id, twoReport))
  assert.deepEqual([closed.status, closed.resolvedBy, !!closed.resolvedAt], ['dismissed', admin, true])
  assert.equal((await call(bob, 'POST', `/lessons/${two}/report`, { reason: 'spam' })).status, 201)

  // Unpublish: out of the library and its tags, can't be started or served, its reports resolved. The author keeps it, marked removed.
  assert.ok(await playable(one, bob))
  assert.equal((await call('', 'GET', `/api/scenario?id=${one}`)).status, 200)
  assert.equal((await call('', 'GET', `/api/lessons/${one}`)).body.title, one, 'a lesson opens by id')
  assert.ok(Array.isArray((await call('', 'GET', '/api/lessons/tags')).body), '/lessons/tags is not taken for an id')
  assert.equal((await call(admin, 'POST', `/admin/lessons/${one}/unpublish`, {}, 'admin')).status, 400, 'a reason is required')
  assert.equal((await call(admin, 'POST', `/admin/lessons/${one}/unpublish`, { reason: 'Offensive content.' }, 'admin')).status, 200)
  assert.deepEqual(await listed(), [two])
  assert.equal(await tagCount(), 1)
  assert.equal(await removed(one), true)
  assert.equal(await playable(one, bob), null, 'no new shifts')
  assert.equal(await playable(one, alice), null, 'not even for its author')
  assert.equal((await call('', 'GET', `/api/scenario?id=${one}`)).status, 404)
  assert.deepEqual(await call('', 'GET', `/api/lessons/${one}`), { status: 404, body: { error: 'No such lesson.' } })
  assert.equal((await call(guest, 'POST', `/lessons/${one}/report`, { reason: 'spam' })).status, 404, 'a removed lesson is not there to report')
  assert.ok((await db().select().from(lessonReports).where(eq(lessonReports.scenarioId, one))).every(r => r.status === 'resolved'))
  const authorView = (await call(alice, 'GET', '/my/lessons')).body.find((l: { id: string }) => l.id === one)
  assert.deepEqual(authorView.removed, { reason: 'Offensive content.' })
  assert.ok(await db().select().from(scenarioVersions).where(eq(scenarioVersions.scenarioId, one)).then(v => v.length === 1), "the author's versions are kept")

  // A built-in can be unpublished too, and restored. Skipped when it is already down or has open reports, so no real ones get closed.
  const builtIn = 'ledgerly-day2'
  const [had] = await db().select({ hiddenAt: scenarios.hiddenAt }).from(scenarios).where(eq(scenarios.id, builtIn))
  const open = await db().select({ id: lessonReports.id }).from(lessonReports).where(and(eq(lessonReports.scenarioId, builtIn), eq(lessonReports.status, 'open')))
  if (had && !had.hiddenAt && !open.length) {
    await call(admin, 'POST', `/admin/lessons/${builtIn}/unpublish`, { reason: 'Broken.' }, 'admin')
    assert.equal((await call('', 'GET', `/api/scenario?id=${builtIn}`)).status, 404, 'a built-in taken down is not served')
    assert.equal((await call(admin, 'POST', `/admin/lessons/${builtIn}/restore`, {}, 'admin')).status, 200)
    assert.equal((await call('', 'GET', `/api/scenario?id=${builtIn}`)).status, 200)
  }

  // Ban: signed out and kept out, can't author or report, and every lesson of theirs leaves the library.
  const ctx = await auth().$context
  await ctx.internalAdapter.createSession(alice)
  assert.equal((await call(bob, 'POST', `/admin/users/${alice}/ban`)).status, 404)
  assert.equal((await call(admin, 'POST', `/admin/users/${admin}/ban`, {}, 'admin')).status, 400, "an admin can't ban themselves")
  assert.equal((await call(admin, 'POST', `/admin/users/${alice}/ban`, {}, 'admin')).status, 200)
  assert.deepEqual(await db().select().from(sessions).where(eq(sessions.userId, alice)), [], 'signed out everywhere')
  await assert.rejects(ctx.internalAdapter.createSession(alice), /suspended/, "can't sign in again")
  assert.deepEqual(await listed(), [])
  assert.equal(await tagCount(), 0)
  assert.equal(await playable(two, bob), null)
  assert.equal((await call('', 'GET', `/api/scenario?id=${two}`)).status, 404)
  assert.equal((await call(alice, 'POST', '/my/lessons', { spec })).status, 403, "a banned user can't author")
  assert.equal((await call(alice, 'POST', `/my/lessons/${priv}/publish`, { visibility: 'public' })).status, 403, "or publish")
  const bobOnTwo = (await db().select().from(lessonReports).where(eq(lessonReports.scenarioId, two))).filter(r => r.reporterId === bob)
  assert.ok(bobOnTwo.every(r => r.status !== 'open'), 'reports on their lessons are closed')
  await db().update(users).set({ bannedAt: new Date() }).where(eq(users.id, bob))
  assert.equal((await call(bob, 'POST', `/lessons/${two}/report`, { reason: 'spam' })).status, 403, "a banned user can't report")

  // Unban: their lessons come back, except one moderators took down.
  assert.equal((await call(admin, 'POST', `/admin/users/${alice}/unban`, {}, 'admin')).status, 200)
  assert.deepEqual(await listed(), [two])
  assert.ok(await ctx.internalAdapter.createSession(alice))
} finally {
  server.close()
  await db().delete(lessonReports).where(inArray(lessonReports.scenarioId, lessons))
  await db().delete(scenarioVersions).where(inArray(scenarioVersions.scenarioId, lessons))
  await db().delete(scenarios).where(inArray(scenarios.id, lessons))
  await db().delete(users).where(inArray(users.id, [admin, alice, bob, guest, spammer]))
  await closeDb()
}
console.log('moderation check passed')
process.exit(0)
