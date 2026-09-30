// Checks that a run survives a round trip through Postgres, and that the lesson library lists only public lessons. Run with: DATABASE_URL=... npm run check:db
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { eq, like } from 'drizzle-orm'
import { closeDb, db, dbEnabled, migrateDb } from './db/index.ts'
import { publish } from './db/publish.ts'
import { runEvents, runWorkspaces, runs, scenarioVersions, scenarios, users } from './db/schema.ts'
import { lessonTags, listLessons } from './lessons.ts'
import * as director from './director.ts'
import { store } from './runs.ts'
import { scenarioFile } from './scenarios.ts'
import { create, discard, drop, find } from './world.ts'
import { MAX_SNAPSHOT } from './sandbox.ts'

process.env.LLM = 'stub'
if (!dbEnabled()) throw new Error('Set DATABASE_URL to run this check.')
await migrateDb()

const s = await create('bootcamp', 'Ten years in logistics', 4, 'stub', null, undefined, 'ledgerly-day2')
s.timeScale = 0.001
await director.start(s)
for (let i = 0; i < 4; i++) director.tick(s)
director.seen(s, 'chan:team')
const id = s.world.id
assert.ok(s.priv.events.length > 0)
assert.equal(await s.flush(), true)
const [row] = await db().select().from(runs).where(eq(runs.id, id))
assert.deepEqual([row.status, row.level, row.userId], ['active', 'bootcamp', null])
assert.ok(row.version >= 1)
// What JSON keeps, as the file store always has: undefined fields drop out.
const world = JSON.parse(JSON.stringify(s.world)), priv = JSON.parse(JSON.stringify(s.priv))

await drop(id)
const back = (await find(id))!
assert.notEqual(back, s, 'reloaded, not the cached object')
assert.deepEqual({ ...back.world, aiProblem: world.aiProblem }, world, 'world round-trips')
assert.deepEqual(back.priv, priv, 'priv round-trips')
assert.equal(back.rev, row.version)
assert.deepEqual(back.scenario, s.scenario, 'the run keeps its scenario version')
const logged = await db().select().from(runEvents).where(eq(runEvents.runId, id))
assert.deepEqual(logged.map(e => e.seq).sort((a, b) => a - b), priv.events.map((_: unknown, i: number) => i + 1), 'every event is in run_events')

// Two copies of one run: the second writer is refused rather than overwriting the first.
const other = (await store().loadRun(id, back.dir))!
back.set({ pace: 8 })
assert.equal(await back.flush(), true)
const stale = { world: other.world, priv: other.priv, rev: other.rev, dir: back.dir } as typeof back
assert.equal(await store().saveRun(stale), false, 'a stale version is refused')
assert.equal(((await db().select().from(runs).where(eq(runs.id, id)))[0].world as { pace: number }).pace, 8)

// A run pinned to a version that no longer parses falls back to its own scenario's file.
const [junk] = await db().insert(scenarioVersions).values({ scenarioId: 'ledgerly-day2', version: -Date.now() % 2e9, spec: {} }).returning({ id: scenarioVersions.id })
await db().update(runs).set({ scenarioVersionId: junk.id }).where(eq(runs.id, id))
assert.deepEqual((await store().loadRun(id, back.dir))!.scenario, scenarioFile('ledgerly-day2'))
await db().update(runs).set({ scenarioVersionId: row.scenarioVersionId }).where(eq(runs.id, id))
await db().delete(scenarioVersions).where(eq(scenarioVersions.id, junk.id))

await director.end(back)
assert.equal(await back.flush(), true)
const [ended] = await db().select().from(runs).where(eq(runs.id, id))
assert.equal(ended.status, 'ended')
assert.ok(ended.endedAt)

await drop(id)

// ---- the workspace: commits, the branch and unsaved work come back when the disk copy is gone, as after a redeploy.
const wsUser = `check-ws-${Date.now()}`
const p = await create('bootcamp', 'Ten years in logistics', 4, 'stub', wsUser, undefined, 'ledgerly-day2')
p.timeScale = 0.001
await director.start(p)
const vs = 'src/auth/verifySession.ts', readme = 'README.md'
const template = await p.ws.state()
await director.command(p, 'git checkout -b maya/led-214-hotfix')
await director.saveFile(p, vs, (await p.ws.read(vs)) + '\n// committed\n')
await director.commit(p, 'fix(auth): accept bearer tokens')
const committed = await p.ws.state()
assert.equal(committed.subject, 'fix(auth): accept bearer tokens')
await director.saveFile(p, readme, (await p.ws.read(readme)) + '\nNot committed yet.\n')
await director.saveFile(p, 'notes/todo.md', 'untracked\n')
await director.command(p, 'rm src/keys.ts')
await p.flushWorkspace()
const [snap] = await db().select().from(runWorkspaces).where(eq(runWorkspaces.runId, p.world.id))
assert.ok(snap && snap.bytes === snap.bundle.length && snap.bytes < MAX_SNAPSHOT, 'the workspace is snapshotted')
const was = { state: await p.ws.state(), readme: await p.ws.read(readme), tree: await p.ws.tree() }
await drop(p.world.id)
await rm(p.dir, { recursive: true, force: true })
const q = (await find(p.world.id))!
assert.notEqual(q, p)
const after = await q.ws.state()
assert.deepEqual({ ...after, changes: after.changes.map(c => c.path).sort() }, { ...was.state, changes: was.state.changes.map(c => c.path).sort() }, 'branch, HEAD and changed paths come back')
assert.equal(after.branch, 'maya/led-214-hotfix')
assert.equal(after.head, committed.head, 'the commit comes back')
assert.equal(await q.ws.read(readme), was.readme, 'an uncommitted change comes back')
assert.equal(await q.ws.read('notes/todo.md'), 'untracked\n', 'an untracked file comes back')
assert.deepEqual(await q.ws.tree(), was.tree, 'a deleted file stays deleted')
assert.equal((await q.ws.git(['rev-parse', 'maya/led-214-sso-expiry'])).out.trim().length, 40, 'other branches come back')
// A run with no snapshot starts from the template, as before.
await db().delete(runWorkspaces).where(eq(runWorkspaces.runId, q.world.id))
await drop(q.world.id)
await db().delete(runWorkspaces).where(eq(runWorkspaces.runId, q.world.id))
await rm(q.dir, { recursive: true, force: true })
const t = (await find(q.world.id))!
assert.deepEqual(await t.ws.state(), template, 'no snapshot: a fresh template')
// Deleting a player's runs takes their snapshots with them.
await t.flushWorkspace()
assert.equal((await db().select().from(runWorkspaces).where(eq(runWorkspaces.runId, t.world.id))).length, 1)
await discard(wsUser)
assert.equal((await db().select().from(runWorkspaces).where(eq(runWorkspaces.runId, t.world.id))).length, 0, 'discard deletes the snapshot')

// ---- the library: a seeded built-in is public with its tags; a private lesson is not listed, whatever its tags.
await publish(scenarioFile('ledgerly-day2')!)
const ids = async (q = {}) => (await listLessons(q)).map(l => l.id)
const builtIn = (await listLessons()).find(l => l.id === 'ledgerly-day2')!
assert.ok(builtIn, 'a seeded built-in is listed')
assert.deepEqual([builtIn.author, builtIn.tags.includes('incident-response'), !!builtIn.summary], [null, true, true])
assert.ok((await ids({ tag: 'Incident Response' })).includes('ledgerly-day2'), 'a tag filter is normalized and matches')
assert.ok(!(await ids({ tag: 'no-such-tag' })).includes('ledgerly-day2'), 'a tag filter excludes')
assert.ok((await ids({ q: 'sso' })).includes('ledgerly-day2') && !(await ids({ q: '100%' })).includes('ledgerly-day2'), 'text search, with % taken literally')
const counted = async () => (await lessonTags()).find(t => t.tag === 'incident-response')?.count ?? 0
const before = await counted()
assert.ok(before >= 1)

const tag = `check-${Date.now()}`, author = `check-author-${Date.now()}`
await db().insert(users).values({ id: author, name: 'Check Author', email: `${author}@example.test` })
await db().insert(scenarios).values([
  { id: `${tag}-private`, title: 'Private', tags: [tag, 'incident-response'], authorId: author },
  { id: `${tag}-public`, title: 'Public', tags: [tag], visibility: 'public', authorId: author },
  { id: `${tag}-unpublished`, title: 'Unpublished', tags: [tag], visibility: 'public' },
])
await db().insert(scenarioVersions).values([`${tag}-private`, `${tag}-public`].map(scenarioId => ({ scenarioId, version: 1, spec: {}, status: 'published' as const })))
assert.deepEqual(await ids({ tag }), [`${tag}-public`], 'only public lessons with a published version are listed')
assert.deepEqual((await listLessons({ tag }))[0].author, { name: 'Check Author' })
assert.equal(await counted(), before, 'a private lesson\'s tags are not counted')
assert.deepEqual((await lessonTags()).find(t => t.tag === tag), { tag, count: 1 })
await db().delete(users).where(eq(users.id, author))
assert.equal((await listLessons({ tag }))[0].author, null, 'a lesson outlives its author')
await db().delete(scenarioVersions).where(like(scenarioVersions.scenarioId, `${tag}-%`))
await db().delete(scenarios).where(like(scenarios.id, `${tag}-%`))
const listedCount = (await ids()).length

await closeDb()
console.log(`db check passed · ${logged.length} events · run ${id} · workspace snapshot ${snap.bytes} bytes · library lists ${listedCount} lesson(s)`)
process.exit(0)
