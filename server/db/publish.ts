// Publishes a built-in scenario as its next version, unless the latest version already matches it. Built-ins are public and have no author.
import { isDeepStrictEqual } from 'node:util'
import { desc, eq } from 'drizzle-orm'
import type { Scenario } from '../../shared/scenario.ts'
import { db } from './index.ts'
import { scenarioVersions, scenarios } from './schema.ts'

export function publish(spec: Scenario) {
  return db().transaction(async tx => {
    const lesson = { title: spec.title, summary: spec.summary ?? null, tags: spec.tags ?? [], visibility: 'public' as const, authorId: null }
    await tx.insert(scenarios).values({ id: spec.id, ...lesson })
      .onConflictDoUpdate({ target: scenarios.id, set: { ...lesson, updatedAt: new Date() } })
    const [latest] = await tx.select().from(scenarioVersions)
      .where(eq(scenarioVersions.scenarioId, spec.id)).orderBy(desc(scenarioVersions.version)).limit(1)
    // jsonb does not keep key order, so compare values rather than text.
    if (latest?.status === 'published' && isDeepStrictEqual(latest.spec, JSON.parse(JSON.stringify(spec)))) return { id: latest.id, version: latest.version, changed: false }
    const version = (latest?.version ?? 0) + 1
    const [row] = await tx.insert(scenarioVersions).values({ scenarioId: spec.id, version, spec, status: 'published' }).returning({ id: scenarioVersions.id })
    return { id: row.id, version, changed: true }
  })
}
