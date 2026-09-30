// Checks authoring: who may write a lesson, draft → test → publish, and who may play it. Run with: DATABASE_URL=... npm run check:db
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { eq, inArray } from 'drizzle-orm'
import { closeDb, db, dbEnabled, migrateDb } from './db/index.ts'
import { runs, scenarioVersions, scenarios, users } from './db/schema.ts'
import { MAX_LESSONS, lessonsApi, playable } from './authoring.ts'
import * as director from './director.ts'
import { listLessons } from './lessons.ts'
import { errors } from './routes.ts'
import { scenarioFile } from './scenarios.ts'
import { create, drop } from './world.ts'

process.env.LLM = 'stub'
if (!dbEnabled()) throw new Error('Set DATABASE_URL to run this check.')
await migrateDb()

// The lessons routes behind a stand-in for sign-in: x-user names the caller.
const app = express()
app.use(express.json({ limit: '300kb' }), (req: Request, res: Response, next: NextFunction) => { res.locals.me = { id: req.headers['x-user'] }; next() }, lessonsApi, errors)
const server = app.listen(0)
const base = `http://localhost:${(server.address() as AddressInfo).port}`
const call = async (user: string, method: string, path = '', body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': user }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

const tag = `authoring-${Date.now()}`
const [guest, unverified, alice, bob] = ['guest', 'unverified', 'alice', 'bob'].map(n => `${tag}-${n}`)
await db().insert(users).values([
  { id: guest, name: 'Guest', email: `${guest}@example.test`, isAnonymous: true },
  { id: unverified, name: 'Unverified', email: `${unverified}@example.test` },
  { id: alice, name: 'Alice Author', email: `${alice}@example.test`, emailVerified: true },
  { id: bob, name: 'Bob Player', email: `${bob}@example.test`, emailVerified: true },
])
const spec = { ...structuredClone(scenarioFile('ledgerly-day2')!), id: 'ignored', title: 'Rotate the Keys!', summary: 'A check lesson.', tags: [tag] }
const play = async (user: string, id: string) => {
  const found = await playable(id, user)
  if (!found) return null
  const s = await create('bootcamp', '', 4, 'stub', user, { name: 'Tester' }, found)
  s.timeScale = 0.001
  return s
}

try {
  // Who may write.
  for (const u of [guest, unverified]) assert.equal((await call(u, 'POST', '/', { spec })).status, 403, `${u} can't author`)
  assert.equal((await call(alice, 'POST', '/', { spec: { ...spec, title: '' } })).status, 400, 'an invalid spec is refused')
  assert.equal((await call(alice, 'POST', '/', { spec: { ...spec, padding: 'x'.repeat(210_000) } })).status, 413, 'a spec over 200 KB is refused')

  // Draft: the server picks the id, and the spec follows it.
  const made = await call(alice, 'POST', '/', { spec })
  assert.equal(made.status, 201)
  const id: string = made.body.id
  assert.match(id, /^rotate-the-keys-[0-9a-f]{6}$/)
  assert.deepEqual([made.body.spec.id, made.body.visibility, made.body.version, made.body.status, made.body.tested], [id, 'private', 1, 'draft', false])
  assert.equal((await call(alice, 'GET', '/')).body.length, 1)

  // Not tested yet, so it can't be published. Nobody else may play a private draft, or edit it.
  const refused = await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })
  assert.equal(refused.status, 409)
  assert.match(refused.body.error, /finish the shift/)
  assert.equal(await playable(id, bob), null)
  assert.equal(await playable(id, null), null)
  for (const [m, p, b] of [['GET', `/${id}`], ['PUT', `/${id}`, { spec }], ['PATCH', `/${id}`, { visibility: 'public' }], ['POST', `/${id}/publish`, { visibility: 'public' }]] as const) {
    assert.equal((await call(bob, m, p, b)).status, 404, `someone else's ${m} ${p}`)
  }
  assert.equal((await call(alice, 'PUT', '/ledgerly-day2', { spec })).status, 403, "a built-in can't be edited")

  // An untouched draft is overwritten in place.
  const saved = await call(alice, 'PUT', `/${id}`, { spec: { ...spec, title: 'Rotate the keys' } })
  assert.deepEqual([saved.status, saved.body.version, saved.body.title], [200, 1, 'Rotate the keys'])

  // Test: an unfinished shift doesn't count; a finished one on the draft does.
  const s = (await play(alice, id))!
  const [pinned] = await db().select({ v: runs.scenarioVersionId }).from(runs).where(eq(runs.id, s.world.id))
  const [v1] = await db().select().from(scenarioVersions).where(eq(scenarioVersions.scenarioId, id))
  assert.equal(pinned.v, v1.id, 'a run on the draft pins the draft')
  assert.equal(s.scenario.title, 'Rotate the keys')
  await director.start(s)
  assert.equal((await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })).status, 409, 'an unfinished shift is not a test')
  // A draft that has been played becomes the next version when saved, so the run keeps what it played.
  assert.equal((await call(alice, 'PUT', `/${id}`, { spec: { ...spec, title: 'Rotate the keys v2' } })).body.version, 2)
  assert.equal((await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })).status, 409)
  await drop(s.world.id)
  const t = (await play(alice, id))!
  assert.equal(t.scenario.title, 'Rotate the keys v2')
  await director.start(t)
  await director.end(t)
  assert.equal(await t.flush(), true)
  await drop(t.world.id)
  assert.equal((await call(alice, 'GET', `/${id}`)).body.tested, true)

  // Publish: now listed and playable by others.
  assert.equal((await call(alice, 'POST', `/${id}/publish`, { visibility: 'sideways' })).status, 400)
  const pub = await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })
  assert.deepEqual([pub.status, pub.body.status, pub.body.visibility, pub.body.published], [200, 'published', 'public', true])
  assert.equal((await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })).status, 409, 'already published')
  assert.deepEqual((await listLessons({ tag })).map(l => [l.id, l.author?.name]), [[id, 'Alice Author']])
  const other = (await play(bob, id))!
  assert.equal(other.scenario.title, 'Rotate the keys v2')
  await drop(other.world.id)
  assert.ok(await playable(id, null), 'a public lesson is playable (and its roster served) before sign-in')

  // A new draft on top: others keep the published version, the author plays the draft.
  await call(alice, 'PUT', `/${id}`, { spec: { ...spec, title: 'Rotate the keys v3' } })
  assert.equal((await playable(id, bob))!.spec.title, 'Rotate the keys v2')
  assert.equal((await playable(id, alice))!.spec.title, 'Rotate the keys v3')
  assert.deepEqual((await listLessons({ tag })).map(l => l.title), ['Rotate the keys v2'], 'the library shows the published title, not the draft')

  // Visibility: unlisted is playable by link but not listed; private is neither.
  assert.equal((await call(alice, 'PATCH', `/${id}`, { visibility: 'unlisted' })).body.visibility, 'unlisted')
  assert.deepEqual(await listLessons({ tag }), [])
  assert.ok(await playable(id, bob))
  await call(alice, 'PATCH', `/${id}`, { visibility: 'private' })
  assert.equal(await playable(id, bob), null)
  assert.ok(await playable(id, alice))

  // At most MAX_LESSONS each.
  const [first] = await db().select().from(scenarioVersions).where(eq(scenarioVersions.scenarioId, id)).limit(1)
  await db().insert(scenarios).values(Array.from({ length: MAX_LESSONS - 1 }, (_, i) => ({ id: `${tag}-filler-${i}`, title: 'Filler', authorId: alice })))
  await db().insert(scenarioVersions).values(Array.from({ length: MAX_LESSONS - 1 }, (_, i) => ({ scenarioId: `${tag}-filler-${i}`, version: 1, spec: first.spec })))
  assert.equal((await call(alice, 'POST', '/', { spec })).status, 409, 'the lesson limit')
  assert.equal((await call(bob, 'GET', '/')).body.length, 0)
} finally {
  server.close()
  const mine = (await db().select({ id: scenarios.id }).from(scenarios).where(inArray(scenarios.authorId, [alice, bob]))).map(r => r.id)
  if (mine.length) {
    const versions = (await db().select({ id: scenarioVersions.id }).from(scenarioVersions).where(inArray(scenarioVersions.scenarioId, mine))).map(v => v.id)
    if (versions.length) await db().delete(runs).where(inArray(runs.scenarioVersionId, versions))
    await db().delete(scenarioVersions).where(inArray(scenarioVersions.scenarioId, mine))
    await db().delete(scenarios).where(inArray(scenarios.id, mine))
  }
  await db().delete(users).where(inArray(users.id, [guest, unverified, alice, bob]))
  await closeDb()
}
console.log('authoring check passed')
process.exit(0)
