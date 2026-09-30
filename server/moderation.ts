// Moderation, and nothing else: players report lessons, admins unpublish them or ban their authors. There is no content CMS.
// A lesson is live while nobody has hidden it and its author (if any) isn't banned. Hiding keeps the author's data, so it can be undone.
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Me } from './auth.ts'
import { db, dbEnabled } from './db/index.ts'
import { REPORT_REASONS, lessonReports, scenarios, sessions, users } from './db/schema.ts'

export const REPORTS_PER_DAY = 20
export const MAX_NOTE = 500
type Reason = typeof REPORT_REASONS[number]

class Refused extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

/** A condition on `scenarios`: not taken down, and not written by a banned user. Built-ins have no author, so only hiding applies. */
export const live = () => and(isNull(scenarios.hiddenAt), sql`not exists (select 1 from ${users} where ${users.id} = ${scenarios.authorId} and ${users.bannedAt} is not null)`)

/** True when a lesson in the database may no longer be started. A lesson that isn't in the database (a built-in on a fresh one) is fine. */
export async function removed(id: string): Promise<boolean> {
  if (!dbEnabled()) return false
  const [row] = await db().select({ ok: sql<boolean>`${live()!}` }).from(scenarios).where(eq(scenarios.id, id))
  return !!row && !row.ok
}

export async function banned(userId: string): Promise<boolean> {
  const [u] = await db().select({ at: users.bannedAt }).from(users).where(eq(users.id, userId))
  return !!u?.at
}

// ---------- reporting ----------
export async function report(userId: string, id: string, reason: unknown, note: unknown) {
  if (!REPORT_REASONS.includes(reason as Reason)) throw new Refused(400, `reason must be one of: ${REPORT_REASONS.join(', ')}`)
  if (note !== undefined && note !== null && typeof note !== 'string') throw new Refused(400, 'note must be text.')
  const text = typeof note === 'string' ? note.trim() : ''
  if (text.length > MAX_NOTE) throw new Refused(400, `The note is too long (limit ${MAX_NOTE} characters).`)
  if (await banned(userId)) throw new Refused(403, 'This account is suspended.')
  // A lesson nobody may see is missing, so reporting one doesn't confirm it exists.
  const [lesson] = await db().select({ visibility: scenarios.visibility }).from(scenarios).where(and(eq(scenarios.id, id), live()))
  if (!lesson || lesson.visibility === 'private') throw new Refused(404, 'No such lesson.')
  const [{ n }] = await db().select({ n: count() }).from(lessonReports)
    .where(and(eq(lessonReports.reporterId, userId), gt(lessonReports.createdAt, sql`now() - interval '1 day'`)))
  if (n >= REPORTS_PER_DAY) throw new Refused(429, `You have sent ${n} reports today, the most allowed. Try again tomorrow.`)
  const [row] = await db().insert(lessonReports).values({ scenarioId: id, reporterId: userId, reason: reason as Reason, note: text || null })
    .onConflictDoNothing().returning({ id: lessonReports.id })
  if (!row) throw new Refused(409, 'You have already reported this lesson. Moderators will look at it.')
  return { id: row.id }
}

// ---------- the admin's side ----------
export interface QueueItem {
  lesson: { id: string; title: string; hidden: boolean; author: { id: string; name: string; banned: boolean } | null }
  count: number
  reports: { id: string; reason: Reason; note: string | null; createdAt: string; reporter: string }[]
}

/** Open reports, one entry per lesson, the most reported first. */
export async function queue(): Promise<QueueItem[]> {
  const reporter = alias(users, 'reporter')
  const rows = await db().select({
    id: lessonReports.id, reason: lessonReports.reason, note: lessonReports.note, createdAt: lessonReports.createdAt, reporter: reporter.name,
    lessonId: scenarios.id, title: scenarios.title, hiddenAt: scenarios.hiddenAt, authorId: users.id, authorName: users.name, bannedAt: users.bannedAt,
  }).from(lessonReports)
    .innerJoin(scenarios, eq(scenarios.id, lessonReports.scenarioId))
    .innerJoin(reporter, eq(reporter.id, lessonReports.reporterId))
    .leftJoin(users, eq(users.id, scenarios.authorId))
    .where(eq(lessonReports.status, 'open')).orderBy(desc(lessonReports.createdAt))
  const byLesson = new Map<string, QueueItem>()
  for (const r of rows) {
    const item = byLesson.get(r.lessonId) ?? {
      lesson: { id: r.lessonId, title: r.title, hidden: !!r.hiddenAt, author: r.authorId ? { id: r.authorId, name: r.authorName!, banned: !!r.bannedAt } : null },
      count: 0, reports: [],
    }
    item.count++
    item.reports.push({ id: r.id, reason: r.reason, note: r.note, createdAt: r.createdAt.toISOString(), reporter: r.reporter })
    byLesson.set(r.lessonId, item)
  }
  return [...byLesson.values()].sort((a, b) => b.count - a.count)
}

const close = (adminId: string, status: 'resolved' | 'dismissed') => ({ status, resolvedBy: adminId, resolvedAt: new Date() })

export async function closeReport(adminId: string, reportId: string, action: unknown) {
  if (action !== 'resolve' && action !== 'dismiss') throw new Refused(400, 'action must be resolve or dismiss')
  const [row] = await db().update(lessonReports).set(close(adminId, action === 'resolve' ? 'resolved' : 'dismissed'))
    .where(and(sql`${lessonReports.id}::text = ${reportId}`, eq(lessonReports.status, 'open'))).returning({ id: lessonReports.id })
  if (!row) throw new Refused(404, 'No such open report.')
  return { ok: true }
}

/** Takes a lesson out of the library and stops new shifts on it. Shifts already going may finish. Its open reports are resolved. */
export async function unpublish(adminId: string, id: string, reason: unknown) {
  const why = typeof reason === 'string' ? reason.trim().slice(0, MAX_NOTE) : ''
  if (!why) throw new Refused(400, 'Give a reason. The author sees it.')
  await db().transaction(async tx => {
    const [row] = await tx.update(scenarios).set({ hiddenAt: new Date(), hiddenReason: why }).where(eq(scenarios.id, id)).returning({ id: scenarios.id })
    if (!row) throw new Refused(404, 'No such lesson.')
    await tx.update(lessonReports).set(close(adminId, 'resolved')).where(and(eq(lessonReports.scenarioId, id), eq(lessonReports.status, 'open')))
  })
  return { ok: true }
}

export async function restore(id: string) {
  const [row] = await db().update(scenarios).set({ hiddenAt: null, hiddenReason: null }).where(eq(scenarios.id, id)).returning({ id: scenarios.id })
  if (!row) throw new Refused(404, 'No such lesson.')
  return { ok: true }
}

/** Bans a user: signed out everywhere and kept out (see auth.ts), their lessons hidden, open reports on those lessons resolved. */
export async function ban(adminId: string, userId: string) {
  if (userId === adminId) throw new Refused(400, "You can't ban yourself.")
  await db().transaction(async tx => {
    const [u] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId))
    if (!u) throw new Refused(404, 'No such user.')
    if (u.role === 'admin') throw new Refused(400, "Admins can't be banned. Demote them in the database first.")
    await tx.update(users).set({ bannedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.bannedAt)))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    const theirs = tx.select({ id: scenarios.id }).from(scenarios).where(eq(scenarios.authorId, userId))
    await tx.update(lessonReports).set(close(adminId, 'resolved')).where(and(inArray(lessonReports.scenarioId, theirs), eq(lessonReports.status, 'open')))
  })
  return { ok: true }
}

export async function unban(userId: string) {
  const [row] = await db().update(users).set({ bannedAt: null }).where(and(eq(users.id, userId), isNotNull(users.bannedAt))).returning({ id: users.id })
  if (!row) throw new Refused(404, 'No such banned user.')
  return { ok: true }
}

// ---------- routes ----------
/** /api/admin. Anyone but an admin gets the same 404 as a path that doesn't exist, so the routes aren't confirmed to be here. */
export const adminApi = Router()
adminApi.use((_req: Request, res: Response, next: NextFunction) => {
  if ((res.locals.me as Me | undefined)?.role === 'admin' && dbEnabled()) next()
  else next('router')
})
const admin = (res: Response): string => (res.locals.me as Me).id
adminApi.get('/reports', async (_req, res) => { res.json(await queue()) })
adminApi.post('/reports/:id', async (req, res) => { res.json(await closeReport(admin(res), req.params.id, req.body?.action)) })
adminApi.post('/lessons/:id/unpublish', async (req, res) => { res.json(await unpublish(admin(res), req.params.id, req.body?.reason)) })
adminApi.post('/lessons/:id/restore', async (req, res) => { res.json(await restore(req.params.id)) })
adminApi.post('/users/:id/ban', async (req, res) => { res.json(await ban(admin(res), req.params.id)) })
adminApi.post('/users/:id/unban', async (req, res) => { res.json(await unban(req.params.id)) })

/** POST /api/lessons/:id/report, for anyone signed in, guests included. */
export async function reportRoute(req: Request, res: Response) {
  const me = res.locals.me as Me | undefined
  if (!me || !dbEnabled()) throw new Refused(404, 'Accounts are off on this server.')
  res.status(201).json(await report(me.id, String(req.params.id), req.body?.reason, req.body?.note))
}
