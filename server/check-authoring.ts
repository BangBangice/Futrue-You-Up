// Checks authoring: who may write a lesson, draft → test → publish, who may play it, and AI generation with its daily quota. Run with: DATABASE_URL=... npm run check:db
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { eq, inArray } from 'drizzle-orm'
import { closeDb, db, dbEnabled, migrateDb } from './db/index.ts'
import { lessonGenerations, runs, scenarioVersions, scenarios, users } from './db/schema.ts'
import { MAX_LESSONS, lessonsApi, playable } from './authoring.ts'
import * as director from './director.ts'
import { PER_MINUTE as SUGGESTIONS_PER_MINUTE, completeApi, join, model as completer } from './complete.ts'
import { DAILY_GENERATIONS, generateApi, model } from './generate.ts'
import type { Brief } from './generate.ts'
import { listLessons } from './lessons.ts'
import { errors } from './routes.ts'
import { scenarioFile } from './scenarios.ts'
import { create, drop } from './world.ts'

process.env.LLM = 'stub'
if (!dbEnabled()) throw new Error('Set DATABASE_URL to run this check.')
await migrateDb()

// The lessons routes behind a stand-in for sign-in: x-user names the caller.
const app = express()
app.use(express.json({ limit: '300kb' }), (req: Request, res: Response, next: NextFunction) => { res.locals.me = { id: req.headers['x-user'] }; next() }, generateApi, completeApi, lessonsApi, errors)
const server = app.listen(0)
const base = `http://localhost:${(server.address() as AddressInfo).port}`
const call = async (user: string, method: string, path = '', body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': user }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

const tag = `authoring-${Date.now()}`
const [guest, unverified, alice, bob, carol] = ['guest', 'unverified', 'alice', 'bob', 'carol'].map(n => `${tag}-${n}`)
await db().insert(users).values([
  { id: guest, name: 'Guest', email: `${guest}@example.test`, isAnonymous: true },
  { id: unverified, name: 'Unverified', email: `${unverified}@example.test` },
  { id: alice, name: 'Alice Author', email: `${alice}@example.test`, emailVerified: true },
  { id: bob, name: 'Bob Player', email: `${bob}@example.test`, emailVerified: true },
  { id: carol, name: 'Carol Prompter', email: `${carol}@example.test`, emailVerified: true },
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
  assert.match(refused.body.error, /ship the fix/)
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
  assert.deepEqual([t.world.lesson.mine, t.world.recap?.finished], [true, false], 'the author sees that this test did not count')
  assert.equal(await t.flush(), true)
  await drop(t.world.id)
  // Ended from the End shift button before the work was done: not a test.
  assert.equal((await call(alice, 'GET', `/${id}`)).body.tested, false, 'a shift ended early is not a test')
  assert.equal((await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })).status, 409)
  // Finished: the fix shipped and every check passes, then the shift ends.
  const u = (await play(alice, id))!
  await director.start(u)
  const vs = 'src/auth/verifySession.ts'
  await director.saveFile(u, vs, (await u.ws.read(vs)).replace('  const token = req.cookies[SESSION_COOKIE]\n',
    "  const header = req.headers['authorization'] ?? ''\n  const token = header.replace(/^Bearer\\s+/i, '') || req.cookies[SESSION_COOKIE]\n"))
  await director.command(u, 'git commit -am "fix(auth): read the bearer header (LED-214)"')
  await director.command(u, 'ldg deploy auth-api --env prod')
  assert.ok(u.priv.f.fixedAt !== undefined, 'the fix shipped')
  await director.end(u)
  assert.equal(u.priv.finished, true)
  assert.deepEqual([u.world.lesson.title, u.world.recap?.finished], ['Rotate the keys v2', true], 'and that this one did')
  assert.equal(await u.flush(), true)
  await drop(u.world.id)
  assert.equal((await call(alice, 'GET', `/${id}`)).body.tested, true, 'a finished shift is a test')

  // Publish: now listed and playable by others.
  assert.equal((await call(alice, 'POST', `/${id}/publish`, { visibility: 'sideways' })).status, 400)
  const pub = await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })
  assert.deepEqual([pub.status, pub.body.status, pub.body.visibility, pub.body.published], [200, 'published', 'public', true])
  assert.equal((await call(alice, 'POST', `/${id}/publish`, { visibility: 'public' })).status, 409, 'already published')
  assert.deepEqual((await listLessons({ tag })).map(l => [l.id, l.author?.name]), [[id, 'Alice Author']])
  const other = (await play(bob, id))!
  assert.equal(other.scenario.title, 'Rotate the keys v2')
  assert.equal(other.world.lesson.mine, undefined, 'only its author is testing it')
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

  // ---- AI generation, with the model stubbed (LLM=stub): Ledgerly, lightly changed so the prompt shows.
  const ledgerly = scenarioFile('ledgerly-day2')!
  const generate = (user: string, body: unknown) => call(user, 'POST', '/generate', body)
  for (const u of [guest, unverified]) assert.equal((await generate(u, { prompt: 'A lesson' })).status, 403, `${u} can't generate`)
  assert.equal((await generate(carol, { prompt: '  ' })).status, 400, 'a prompt is required')
  assert.equal((await call(carol, 'GET', '/generate')).body.remaining, DAILY_GENERATIONS)
  const prompt = 'A payroll startup where the on-call engineer is out sick'
  const gen = await generate(carol, { prompt })
  assert.equal(gen.status, 201)
  const lid: string = gen.body.lesson.id
  assert.deepEqual([gen.body.lesson.title, gen.body.lesson.status, gen.body.lesson.version, gen.body.lesson.prompt, gen.body.generations.remaining],
    [prompt, 'draft', 1, prompt, DAILY_GENERATIONS - 1])
  assert.deepEqual(gen.body.lesson.spec.checks, ledgerly.checks)
  const promptOf = async () => (await db().select({ p: scenarioVersions.sourcePrompt }).from(scenarioVersions).where(eq(scenarioVersions.scenarioId, lid)))[0].p
  assert.equal(await promptOf(), prompt, 'the prompt is stored with the version')

  // Revision: the draft follows the new prompt, in place while unplayed.
  const rev = await generate(carol, { prompt: 'Make Leo more anxious', lessonId: lid })
  assert.deepEqual([rev.status, rev.body.lesson.version, rev.body.lesson.summary, rev.body.lesson.title], [200, 1, 'Revised: Make Leo more anxious', prompt])
  assert.equal(await promptOf(), 'Make Leo more anxious')
  assert.equal((await generate(bob, { prompt: 'Mine now', lessonId: lid })).status, 404, "someone else's lesson")

  // The code's side is put back whatever the model writes: the checks, and the ticket for the workspace's bug.
  const real = model.write
  const seen: Brief[] = []
  const answers = (...a: unknown[]) => { seen.length = 0; model.write = async b => { seen.push(b); return a.length > 1 ? a.shift() : a[0] } }
  const drifted = structuredClone(ledgerly)
  drifted.checks = [{ id: 'made_up', label: 'Made up', share: 1 }]
  drifted.seed.tickets = drifted.seed.tickets.map(t => t.id === 'LED-214' ? { ...t, title: 'Something else entirely' } : t)
  // Labels may change: a customer's name (not its figures), the story's client company and the repo.
  drifted.customers.named[0] = { ...drifted.customers.named[0], name: 'Kestrel Haulage', short: 'Kestrel', password: 999 }
  drifted.story = { ...drifted.story, customer: 'Kestrel Haulage' }
  drifted.workspace = { repo: 'books-api', host: 'quill-mbp-7' }
  answers(drifted)
  const anchored = await generate(carol, { prompt: 'Change the bug', lessonId: lid })
  assert.equal(anchored.status, 200)
  assert.deepEqual(anchored.body.lesson.spec.checks, ledgerly.checks)
  assert.equal(anchored.body.lesson.spec.seed.tickets.find((t: { id: string }) => t.id === 'LED-214').title, ledgerly.seed.tickets[0].title)
  assert.deepEqual(anchored.body.lesson.spec.customers.named[0], { ...ledgerly.customers.named[0], name: 'Kestrel Haulage', short: 'Kestrel' })
  assert.deepEqual([anchored.body.lesson.spec.story.customer, anchored.body.lesson.spec.workspace.repo], ['Kestrel Haulage', 'books-api'])
  assert.match(seen[0].system, /Keep these cast ids/)
  assert.match(seen[0].user, /current lesson/)

  // One repair round-trip with the errors, then it passes.
  answers('```json\n{ "title": "" }\n```', { ...ledgerly, title: 'Repaired' })
  const repaired = await generate(carol, { prompt: 'Retitle it', lessonId: lid })
  assert.deepEqual([repaired.status, repaired.body.lesson.title, seen.length], [200, 'Repaired', 2])
  assert.match(seen[1].user, /refused for these problems/)
  // Still invalid after the repair: a clear 422, and the draft is untouched.
  answers({ nonsense: true })
  const bad = await generate(carol, { prompt: 'Break it', lessonId: lid })
  assert.deepEqual([bad.status, seen.length], [422, 2])
  assert.match(bad.body.error, /doesn't fit the format/)
  assert.equal((await call(carol, 'GET', `/${lid}`)).body.title, 'Repaired')
  // The model not answering doesn't cost a generation.
  answers(null)
  const before = (await call(carol, 'GET', '/generate')).body.remaining
  const down = await generate(carol, { prompt: 'Anything', lessonId: lid })
  assert.deepEqual([down.status, down.body.generations.remaining], [503, before])
  model.write = real

  // The quota: DAILY_GENERATIONS a day, counted in Postgres, so a restart doesn't reset it. The 422 counted too.
  assert.equal(before, DAILY_GENERATIONS - 5)
  for (let i = before; i > 0; i--) assert.equal((await generate(carol, { prompt: `Pass ${i}`, lessonId: lid })).body.generations.remaining, i - 1)
  const over = await generate(carol, { prompt: 'One more', lessonId: lid })
  assert.equal(over.status, 429, `the ${DAILY_GENERATIONS + 1}th generation is refused`)
  assert.match(over.body.error, /reset at midnight UTC/)
  assert.equal(over.body.generations.remaining, 0)
  assert.ok(Date.parse(over.body.generations.resetsAt) > Date.now())
  const [row] = await db().select().from(lessonGenerations).where(eq(lessonGenerations.userId, carol))
  assert.equal(row.count, DAILY_GENERATIONS)
  assert.equal((await generate(bob, { prompt })).status, 201, 'the quota is per author')

  // ---- Suggestions while typing: free, only for authors, only on your own lesson, and rate-limited per author.
  const suggest = (user: string, body: unknown) => call(user, 'POST', '/complete', body)
  for (const u of [guest, unverified]) assert.equal((await suggest(u, { text: 'A fintech startup on a Friday' })).status, 403, `${u} gets no suggestions`)
  assert.deepEqual((await suggest(carol, { text: 'Too short' })).body, { suggestion: '' }, 'no suggestion before there is an idea')
  const stubbed = await suggest(carol, { text: 'A Friday before a release' })
  assert.deepEqual([stubbed.status, stubbed.body.suggestion], [200, ' at a small fintech startup'])
  assert.equal((await call(carol, 'GET', '/generate')).body.remaining, 0, "suggestions don't spend generations")
  assert.equal((await suggest(bob, { text: 'Make the manager meaner', lessonId: lid })).status, 404, "no suggestions on someone else's lesson")
  const heardFor: string[] = []
  const realComplete = completer.complete
  completer.complete = async (text, base) => { heardFor.push(base?.title ?? ''); return text.includes('echo') ? '"the client echo and more"' : null }
  assert.deepEqual((await suggest(carol, { text: 'Make the client echo', lessonId: lid })).body, { suggestion: ' and more' }, 'the echo and quotes are trimmed')
  assert.ok(heardFor[0], 'a revision is suggested with the lesson in mind')
  assert.deepEqual((await suggest(carol, { text: 'The model is not answering' })).body, { suggestion: '' })
  completer.complete = realComplete
  let limited = 0
  for (let i = 0; i < SUGGESTIONS_PER_MINUTE; i++) if ((await suggest(alice, { text: `A fintech startup, take ${i}` })).status === 429) limited++
  assert.equal(limited, 0)
  assert.equal((await suggest(alice, { text: 'A fintech startup, once more' })).status, 429, 'suggestions are rate-limited per author')

  // How a suggestion is fitted onto the text.
  assert.equal(join('A shift.', 'The PM'), ' The PM', 'a space after punctuation')
  assert.equal(join('A shift ', ' at a bank'), 'at a bank', 'no double space')
  assert.equal(join('A startu', 'p in Berlin'), 'p in Berlin', 'finishing a word')
  assert.equal(join('A shift', 'line one\nline two'), 'line one line two', 'one line')
} finally {
  server.close()
  const mine = (await db().select({ id: scenarios.id }).from(scenarios).where(inArray(scenarios.authorId, [alice, bob, carol]))).map(r => r.id)
  if (mine.length) {
    const versions = (await db().select({ id: scenarioVersions.id }).from(scenarioVersions).where(inArray(scenarioVersions.scenarioId, mine))).map(v => v.id)
    if (versions.length) await db().delete(runs).where(inArray(runs.scenarioVersionId, versions))
    await db().delete(scenarioVersions).where(inArray(scenarioVersions.scenarioId, mine))
    await db().delete(scenarios).where(inArray(scenarios.id, mine))
  }
  await db().delete(users).where(inArray(users.id, [guest, unverified, alice, bob, carol]))
  await closeDb()
}
console.log('authoring check passed')
process.exit(0)
