// Where a shift's state and event log are kept: .data/ by default, Postgres when DATABASE_URL is set.
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { Scenario } from '../shared/scenario.ts'
import type { World } from '../shared/types.ts'
import { db, dbEnabled } from './db/index.ts'
import { publish } from './db/publish.ts'
import { runEvents, runs, scenarioVersions } from './db/schema.ts'
import type { Event, Priv, Session } from './world.ts'

export interface Saved { world: World; priv: Priv; scenario: Scenario; rev: number }
export interface RunStore {
  /** The scenario a new run plays, and the version row it is pinned to. */
  pickScenario(file: Scenario): Promise<{ spec: Scenario; version?: string }>
  createRun(s: Session, version?: string): Promise<void>
  /** False when another writer got there first. */
  saveRun(s: Session): Promise<boolean>
  appendEvent(s: Session, e: Event): void
  loadRun(id: string, dir: string, file: Scenario): Promise<Saved | null>
}

const files: RunStore = {
  pickScenario: async file => ({ spec: file }),
  createRun: async () => {},
  saveRun: s => writeFile(join(s.dir, 'session.json'), JSON.stringify({ world: s.world, priv: s.priv })).then(() => true, () => false),
  appendEvent: (s, e) => { appendFile(join(s.dir, 'events.jsonl'), JSON.stringify(e) + '\n').catch(() => {}) },
  async loadRun(_id, dir, file) {
    const path = join(dir, 'session.json')
    if (!existsSync(path)) return null
    return { ...JSON.parse(await readFile(path, 'utf8')), scenario: file, rev: 0 }
  },
}

const postgres: RunStore = {
  async pickScenario(file) {
    const [row] = await db().select().from(scenarioVersions)
      .where(and(eq(scenarioVersions.scenarioId, file.id), eq(scenarioVersions.status, 'published')))
      .orderBy(desc(scenarioVersions.version)).limit(1)
    const parsed = row && Scenario.safeParse(row.spec)
    if (parsed?.success) return { spec: parsed.data, version: row.id }
    // Nothing published yet, or the latest was written for an older schema.
    return { spec: file, version: (await publish(file)).id }
  },
  async createRun(s, version) {
    await db().insert(runs).values({ id: s.world.id, scenarioVersionId: version!, level: s.world.level, world: s.world, priv: s.priv })
  },
  async saveRun(s) {
    const ended = s.world.stage === 'recap'
    try {
      const done = await db().update(runs)
        .set({ world: s.world, priv: s.priv, version: sql`${runs.version} + 1`, updatedAt: new Date(), status: ended ? 'ended' : 'active', endedAt: ended ? sql`coalesce(${runs.endedAt}, now())` : null })
        .where(and(eq(runs.id, s.world.id), eq(runs.version, s.rev))).returning({ version: runs.version })
      if (!done.length) {
        console.warn(`[runs] ${s.world.id}: not saved, another writer has updated this run since version ${s.rev}`)
        return false
      }
      s.rev = done[0].version
      return true
    } catch (err) {
      console.warn(`[runs] ${s.world.id}: save failed`, err)
      return false
    }
  },
  appendEvent(s, { t, type, ...data }) {
    db().insert(runEvents).values({ runId: s.world.id, seq: s.priv.events.length, simMin: t, type, data })
      .catch(err => console.warn(`[runs] ${s.world.id}: event not logged`, err))
  },
  async loadRun(id) {
    const [row] = await db().select({ run: runs, spec: scenarioVersions.spec }).from(runs)
      .innerJoin(scenarioVersions, eq(runs.scenarioVersionId, scenarioVersions.id)).where(eq(runs.id, id))
    if (!row) return null
    const priv = row.run.priv as Priv
    const logged = await db().select().from(runEvents).where(eq(runEvents.runId, id)).orderBy(asc(runEvents.seq))
    // Events are written as they happen, the rest on a debounce, so the table can be ahead of priv.
    if (logged.length > priv.events.length) priv.events = logged.map(e => ({ ...(e.data as object), t: e.simMin, type: e.type }))
    return { world: row.run.world as World, priv, scenario: Scenario.parse(row.spec), rev: row.run.version }
  },
}

// Chosen on first use, so a script can drop DATABASE_URL before any run starts.
let chosen: RunStore | undefined
export const store = () => (chosen ??= dbEnabled() ? postgres : files)
