// Checks that a run survives a round trip through Postgres. Run with: DATABASE_URL=... npm run check:db
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { closeDb, db, dbEnabled, migrateDb } from './db/index.ts'
import { runEvents, runs } from './db/schema.ts'
import * as director from './director.ts'
import { store } from './runs.ts'
import { create, drop, find } from './world.ts'

process.env.LLM = 'stub'
if (!dbEnabled()) throw new Error('Set DATABASE_URL to run this check.')
await migrateDb()

const s = await create('bootcamp', 'Ten years in logistics', 4, 'stub')
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
const other = (await store().loadRun(id, back.dir, back.scenario))!
back.set({ pace: 8 })
assert.equal(await back.flush(), true)
const stale = { world: other.world, priv: other.priv, rev: other.rev, dir: back.dir } as typeof back
assert.equal(await store().saveRun(stale), false, 'a stale version is refused')
assert.equal(((await db().select().from(runs).where(eq(runs.id, id)))[0].world as { pace: number }).pace, 8)

await director.end(back)
assert.equal(await back.flush(), true)
const [ended] = await db().select().from(runs).where(eq(runs.id, id))
assert.equal(ended.status, 'ended')
assert.ok(ended.endedAt)

await drop(id)
await closeDb()
console.log(`db check passed · ${logged.length} events · run ${id}`)
process.exit(0)
