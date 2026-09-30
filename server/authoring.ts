// Lessons that players write: a verified user drafts one, tests it by finishing a shift on the draft, then publishes it.
// Postgres only, like accounts. Built-ins (no author) are published from their files and can't be edited here.
import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { Response } from 'express'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { Scenario } from '../shared/scenario.ts'
import { db, dbEnabled } from './db/index.ts'
import { runs, scenarioVersions, scenarios, users } from './db/schema.ts'
import { removed } from './moderation.ts'

export const MAX_SPEC_BYTES = 200_000
export const MAX_LESSONS = 20
export const VISIBILITIES = ['private', 'unlisted', 'public'] as const
export type Visibility = typeof VISIBILITIES[number]

export class Refused extends Error {
  status: number
  /** More for the response body, next to the error. */
  extra: Record<string, unknown>
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.extra = extra }
}
type Version = typeof scenarioVersions.$inferSelect

/** Guests and unconfirmed addresses can play but not write. */
export async function author(userId: string) {
  const [u] = await db().select({ anon: users.isAnonymous, verified: users.emailVerified, banned: users.bannedAt }).from(users).where(eq(users.id, userId))
  if (u?.banned) throw new Refused(403, 'This account is suspended.')
  if (!u || u.anon) throw new Refused(403, 'Create an account and confirm your email to write lessons.')
  if (!u.verified) throw new Refused(403, 'Confirm your email address to write lessons.')
}

/** The caller's own lesson. Someone else's is missing, not forbidden, so its id is not confirmed to exist. */
export async function owned(userId: string, id: string) {
  const [row] = await db().select().from(scenarios).where(eq(scenarios.id, id))
  if (row && row.authorId === null) throw new Refused(403, "Built-in lessons can't be edited.")
  if (!row || row.authorId !== userId) throw new Refused(404, 'No such lesson.')
  return row
}

export const latest = async (id: string, published = false): Promise<Version | undefined> => (await db().select().from(scenarioVersions)
  .where(and(eq(scenarioVersions.scenarioId, id), published ? eq(scenarioVersions.status, 'published') : undefined))
  .orderBy(desc(scenarioVersions.version)).limit(1))[0]

/** Which of these versions the author has finished a shift on: ended with the lesson's work done (director.end sets
 * `finished`), not just ended early from the Finish lesson button. */
async function tested(userId: string, versionIds: string[]) {
  if (!versionIds.length) return new Set<string>()
  const rows = await db().selectDistinct({ id: runs.scenarioVersionId }).from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.status, 'ended'), sql`(${runs.priv} ->> 'finished')::boolean`, inArray(runs.scenarioVersionId, versionIds)))
  return new Set(rows.map(r => r.id))
}

// Ascii only: a scenario id is lowercase letters, digits and dashes.
export const slug = (title: unknown) => (typeof title === 'string' ? title : '').normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'lesson'

/** Checks a submitted spec, with its id set to the lesson's. */
export function check(raw: unknown, id: string): Scenario {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Refused(400, 'spec is required, as a JSON object.')
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_SPEC_BYTES) throw new Refused(413, `The lesson is too big (limit ${MAX_SPEC_BYTES / 1000} KB).`)
  const parsed = Scenario.safeParse({ ...raw, id })
  if (!parsed.success) throw new Refused(400, `The lesson doesn't match the scenario format:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}
const visibility = (v: unknown): Visibility => {
  if (!VISIBILITIES.includes(v as Visibility)) throw new Refused(400, `visibility must be one of: ${VISIBILITIES.join(', ')}`)
  return v as Visibility
}
const meta = (spec: Scenario) => ({ title: spec.title, summary: spec.summary ?? null, tags: spec.tags ?? [] })

export interface MyLesson {
  id: string; title: string; summary: string | null; tags: string[]; visibility: Visibility; updatedAt: string
  version: number; status: 'draft' | 'published'; tested: boolean; published: boolean
  /** Set when moderators took the lesson down ("Removed by moderators"), with their reason. */
  removed: { reason: string } | null
}

export async function myLessons(userId: string): Promise<MyLesson[]> {
  const rows = await db().select().from(scenarios).where(eq(scenarios.authorId, userId)).orderBy(desc(scenarios.updatedAt))
  if (!rows.length) return []
  const versions = await db().select({ id: scenarioVersions.id, scenarioId: scenarioVersions.scenarioId, version: scenarioVersions.version, status: scenarioVersions.status })
    .from(scenarioVersions).where(inArray(scenarioVersions.scenarioId, rows.map(r => r.id))).orderBy(desc(scenarioVersions.version))
  const newest = new Map<string, typeof versions[number]>()
  for (const v of versions) if (!newest.has(v.scenarioId)) newest.set(v.scenarioId, v)
  const done = await tested(userId, [...newest.values()].map(v => v.id))
  return rows.map(r => {
    const v = newest.get(r.id)!
    return {
      id: r.id, title: r.title, summary: r.summary, tags: r.tags, visibility: r.visibility, updatedAt: r.updatedAt.toISOString(),
      version: v.version, status: v.status, tested: done.has(v.id), published: versions.some(x => x.scenarioId === r.id && x.status === 'published'),
      removed: r.hiddenAt ? { reason: r.hiddenReason ?? '' } : null,
    }
  })
}

export async function myLesson(userId: string, id: string) {
  await owned(userId, id)
  const found = (await myLessons(userId)).find(l => l.id === id)!
  const v = (await latest(id))!
  return { ...found, spec: v.spec as Scenario, prompt: v.sourcePrompt }
}

/** Refuses a new lesson once the author has as many as allowed. */
export async function roomForOne(userId: string) {
  const [{ n }] = await db().select({ n: count() }).from(scenarios).where(eq(scenarios.authorId, userId))
  if (n >= MAX_LESSONS) throw new Refused(409, `You have ${n} lessons, the most allowed for now.`)
}

/** `prompt` is what the author asked the AI for, when it wrote this spec. */
export async function createLesson(userId: string, raw: unknown, prompt?: string) {
  await author(userId)
  await roomForOne(userId)
  const id = `${slug((raw as { title?: unknown } | null)?.title)}-${randomBytes(3).toString('hex')}`
  const spec = check(raw, id)
  await db().transaction(async tx => {
    await tx.insert(scenarios).values({ id, ...meta(spec), visibility: 'private', authorId: userId })
    await tx.insert(scenarioVersions).values({ scenarioId: id, version: 1, spec, status: 'draft', createdBy: userId, sourcePrompt: prompt })
  })
  return myLesson(userId, id)
}

/** Saves a new draft. The latest draft is overwritten only while no shift has been played on it, so a run's pinned version never
 * changes under it and a test always counts for the spec it played. Otherwise the draft becomes the next version.
 * The library shows the published version, so once there is one the title, summary and tags wait for the next publish. */
export async function saveDraft(userId: string, id: string, raw: unknown, prompt?: string) {
  await author(userId)
  await owned(userId, id)
  const spec = check(raw, id)
  await db().transaction(async tx => {
    const [top] = await tx.select().from(scenarioVersions).where(eq(scenarioVersions.scenarioId, id)).orderBy(desc(scenarioVersions.version)).limit(1).for('update')
    const [played] = top ? await tx.select({ id: runs.id }).from(runs).where(eq(runs.scenarioVersionId, top.id)).limit(1) : []
    if (top?.status === 'draft' && !played) await tx.update(scenarioVersions).set({ spec, createdAt: new Date(), ...(prompt && { sourcePrompt: prompt }) }).where(eq(scenarioVersions.id, top.id))
    else await tx.insert(scenarioVersions).values({ scenarioId: id, version: (top?.version ?? 0) + 1, spec, status: 'draft', createdBy: userId, sourcePrompt: prompt })
    const [live] = await tx.select({ id: scenarioVersions.id }).from(scenarioVersions)
      .where(and(eq(scenarioVersions.scenarioId, id), eq(scenarioVersions.status, 'published'))).limit(1)
    await tx.update(scenarios).set({ ...(live ? {} : meta(spec)), updatedAt: new Date() }).where(eq(scenarios.id, id))
  })
  return myLesson(userId, id)
}

/** Publishes the latest draft, once its author has finished a shift on that exact version. */
export async function publishLesson(userId: string, id: string, to: unknown) {
  await author(userId)
  await owned(userId, id)
  const vis = visibility(to)
  const top = (await latest(id))!
  if (top.status === 'published') throw new Refused(409, `Version ${top.version} is already published. Save a new draft to publish changes.`)
  if (!(await tested(userId, [top.id])).has(top.id)) {
    throw new Refused(409, `Test the draft first: play version ${top.version} yourself, finish its work (every step, or for the incident shift the fix shipped with every check passing), then press Finish lesson. Then publish.`)
  }
  await db().transaction(async tx => {
    await tx.update(scenarioVersions).set({ status: 'published' }).where(eq(scenarioVersions.id, top.id))
    await tx.update(scenarios).set({ ...meta(top.spec as Scenario), visibility: vis, updatedAt: new Date() }).where(eq(scenarios.id, id))
  })
  return myLesson(userId, id)
}

export async function setVisibility(userId: string, id: string, to: unknown) {
  await author(userId)
  await owned(userId, id)
  const vis = visibility(to)
  if (!(await latest(id, true))) throw new Refused(409, 'Publish the lesson before changing who can see it.')
  await db().update(scenarios).set({ visibility: vis, updatedAt: new Date() }).where(eq(scenarios.id, id))
  return myLesson(userId, id)
}

/** What a player may play of a lesson in the database: its author gets the latest version, draft or not, which is how a draft is
 * tested; anyone else the latest published version of a public or unlisted lesson. Null when there is nothing they may play. */
export async function playable(id: string, userId: string | null): Promise<{ spec: Scenario; version: string; mine: boolean } | null> {
  if (!dbEnabled() || await removed(id)) return null
  const [row] = await db().select({ authorId: scenarios.authorId, visibility: scenarios.visibility }).from(scenarios).where(eq(scenarios.id, id))
  if (!row) return null
  const mine = row.authorId !== null && row.authorId === userId
  if (!mine && row.visibility === 'private') return null
  const v = await latest(id, !mine)
  const spec = v && Scenario.safeParse(v.spec)
  return spec?.success ? { spec: spec.data, version: v!.id, mine } : null
}

// ---------- routes: /api/my/lessons, mounted after sign-in ----------
export const who = (res: Response): string => {
  if (!res.locals.me) throw new Refused(404, 'Accounts are off on this server.')
  return res.locals.me.id
}
export const lessonsApi = Router()
lessonsApi.get('/', async (_req, res) => { res.json(await myLessons(who(res))) })
lessonsApi.post('/', async (req, res) => { res.status(201).json(await createLesson(who(res), req.body?.spec)) })
lessonsApi.get('/:id', async (req, res) => { res.json(await myLesson(who(res), req.params.id)) })
lessonsApi.put('/:id', async (req, res) => { res.json(await saveDraft(who(res), req.params.id, req.body?.spec)) })
lessonsApi.patch('/:id', async (req, res) => { res.json(await setVisibility(who(res), req.params.id, req.body?.visibility)) })
lessonsApi.post('/:id/publish', async (req, res) => { res.json(await publishLesson(who(res), req.params.id, req.body?.visibility)) })
