// Reads scenario files from scenarios/ and refuses any that do not match the schema.
import { readFileSync } from 'node:fs'
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
