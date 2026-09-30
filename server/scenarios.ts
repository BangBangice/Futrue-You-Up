// Reads scenario files from scenarios/ and refuses any that do not match the schema.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { Scenario } from '../shared/scenario.ts'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenarios')

export function loadScenario(id: string): Scenario {
  const file = join(DIR, id + '.json')
  const parsed = Scenario.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) throw new Error(`${file} is not a valid scenario:\n${z.prettifyError(parsed.error)}`)
  if (parsed.data.id !== id) throw new Error(`${file} declares id "${parsed.data.id}"; it must match the file name`)
  return parsed.data
}

/** The scenario a run plays when nobody picks one, and the one a run falls back to once its own file is gone. */
export const DEFAULT_SCENARIO = 'ledgerly-day2'
// Loaded once at startup, so a broken scenario file stops the server instead of a shift.
const CATALOG = new Map(readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(f => loadScenario(f.slice(0, -'.json'.length))).map(s => [s.id, s]))
if (!CATALOG.has(DEFAULT_SCENARIO)) throw new Error(`${join(DIR, DEFAULT_SCENARIO + '.json')} is missing; runs fall back to it`)

export const catalog = () => [...CATALOG.values()]
export const scenarioFile = (id: string) => CATALOG.get(id)
