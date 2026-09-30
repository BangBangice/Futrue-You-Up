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

// Two containers starting together (a deploy overlapping the old one, or a pre-deploy step and the app) must not migrate at once.
const MIGRATION_LOCK = 725_311
export async function migrateDb() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK])
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
  } finally {
    await client.end()
  }
}

export async function closeDb() {
  await pool?.end()
  pool = instance = undefined
}
