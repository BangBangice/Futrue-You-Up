// The lesson library: public lessons anyone can browse, signed in or not. Read-only for now.
import { and, arrayContains, desc, eq, exists, ilike, or, sql } from 'drizzle-orm'
import { normalizeTag } from '../shared/tags.ts'
import { db, dbEnabled } from './db/index.ts'
import { scenarioVersions, scenarios, users } from './db/schema.ts'
import { catalog } from './scenarios.ts'

export interface Lesson { id: string; title: string; summary: string | null; tags: string[]; author: { name: string } | null; updatedAt: string }
export interface LessonQuery { tag?: unknown; q?: unknown }

const LIMIT = 50
// The files are read once at startup, so that is as new as they get.
const STARTED = new Date().toISOString()

// Query strings can repeat a key, so anything but one string is ignored.
const clean = ({ tag, q }: LessonQuery) => ({
  tag: typeof tag === 'string' ? normalizeTag(tag) : '',
  q: typeof q === 'string' ? q.trim().slice(0, 100) : '',
})

// A public lesson with nothing published yet has nothing to play.
const listed = () => and(eq(scenarios.visibility, 'public'), exists(db().select({ one: sql`1` }).from(scenarioVersions)
  .where(and(eq(scenarioVersions.scenarioId, scenarios.id), eq(scenarioVersions.status, 'published')))))

export async function listLessons(query: LessonQuery = {}): Promise<Lesson[]> {
  const { tag, q } = clean(query)
  if (!dbEnabled()) return builtIns().filter(l => (!tag || l.tags.includes(tag)) && (!q || `${l.title} ${l.summary ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const like = `%${q.replace(/[\\%_]/g, c => '\\' + c)}%`
  const rows = await db().select({ id: scenarios.id, title: scenarios.title, summary: scenarios.summary, tags: scenarios.tags, authorName: users.name, updatedAt: scenarios.updatedAt })
    .from(scenarios).leftJoin(users, eq(users.id, scenarios.authorId))
    .where(and(listed(), tag ? arrayContains(scenarios.tags, [tag]) : undefined, q ? or(ilike(scenarios.title, like), ilike(scenarios.summary, like)) : undefined))
    .orderBy(desc(scenarios.updatedAt), scenarios.id).limit(LIMIT)
  return rows.map(({ authorName, updatedAt, ...r }) => ({ ...r, author: authorName === null ? null : { name: authorName }, updatedAt: updatedAt.toISOString() }))
}

/** Every tag on a listed lesson, most used first. */
export async function lessonTags(): Promise<{ tag: string; count: number }[]> {
  if (!dbEnabled()) {
    const counts = new Map<string, number>()
    for (const l of builtIns()) for (const t of l.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }
  // Postgres refuses a set-returning function in GROUP BY, so group and sort by position.
  return db().select({ tag: sql<string>`unnest(${scenarios.tags})`, count: sql<number>`count(*)::int` })
    .from(scenarios).where(listed()).groupBy(sql`1`).orderBy(sql`2 desc, 1`)
}

// Without a database there is no library table, so the scenario files are the library: all built-in, all public.
function builtIns(): Lesson[] {
  return catalog().slice(0, LIMIT).map(s => ({ id: s.id, title: s.title, summary: s.summary ?? null, tags: s.tags ?? [], author: null, updatedAt: STARTED }))
}
