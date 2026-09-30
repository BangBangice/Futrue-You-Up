// Optional Postgres. Without DATABASE_URL the server keeps its runs in memory and .data/, as before.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from './schema.ts'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export const dbEnabled = () => !!process.env.DATABASE_URL

let pool: pg.Pool | undefined
let instance: NodePgDatabase<typeof schema> | undefined

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL })
  instance ??= drizzle(pool, { schema })
  return instance
}

export const migrateDb = () => migrate(db(), { migrationsFolder: MIGRATIONS })

export async function closeDb() {
  await pool?.end()
  pool = instance = undefined
}
