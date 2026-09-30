// Publishes every scenarios/*.json as the next version of its scenario, unless the latest version already matches it.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScenario } from '../scenarios.ts'
import { closeDb } from './index.ts'
import { publish } from './publish.ts'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scenarios')

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  const spec = loadScenario(file.slice(0, -'.json'.length))
  const r = await publish(spec)
  console.log(`${spec.id}: ${r.changed ? 'published' : 'unchanged at'} v${r.version}`)
}
await closeDb()
