// Publishes every scenarios/*.json as the next version of its scenario, unless the latest version already matches it.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { desc, eq } from 'drizzle-orm'
import { loadScenario } from '../scenarios.ts'
import { closeDb, db } from './index.ts'
import { scenarioVersions, scenarios } from './schema.ts'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scenarios')

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  const spec = loadScenario(file.slice(0, -'.json'.length))
  const result = await db().transaction(async tx => {
    await tx.insert(scenarios).values({ id: spec.id, title: spec.title })
      .onConflictDoUpdate({ target: scenarios.id, set: { title: spec.title, updatedAt: new Date() } })
    const [latest] = await tx.select().from(scenarioVersions)
      .where(eq(scenarioVersions.scenarioId, spec.id)).orderBy(desc(scenarioVersions.version)).limit(1)
    // jsonb does not keep key order, so compare values rather than text.
    if (latest?.status === 'published' && isDeepStrictEqual(latest.spec, JSON.parse(JSON.stringify(spec)))) return `unchanged at v${latest.version}`
    const version = (latest?.version ?? 0) + 1
    await tx.insert(scenarioVersions).values({ scenarioId: spec.id, version, spec, status: 'published' })
    return `published v${version}`
  })
  console.log(`${spec.id}: ${result}`)
}
await closeDb()
