import { bigserial, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

const at = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow()

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
})

export const scenarioVersions = pgTable('scenario_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioId: text('scenario_id').notNull().references(() => scenarios.id),
  version: integer('version').notNull(),
  spec: jsonb('spec').notNull(),
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  sourcePrompt: text('source_prompt'),
  createdBy: text('created_by'),
  createdAt: at('created_at'),
}, t => [unique().on(t.scenarioId, t.version)])

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id'),
  scenarioVersionId: uuid('scenario_version_id').notNull().references(() => scenarioVersions.id),
  level: text('level').notNull(),
  status: text('status', { enum: ['active', 'ended'] }).notNull().default('active'),
  world: jsonb('world').notNull(),
  priv: jsonb('priv').notNull(),
  version: integer('version').notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  startedAt: at('started_at'),
  updatedAt: at('updated_at'),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, t => [index().on(t.userId)])

export const runEvents = pgTable('run_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  simMin: integer('sim_min').notNull(),
  type: text('type').notNull(),
  data: jsonb('data').notNull(),
  createdAt: at('created_at'),
}, t => [unique().on(t.runId, t.seq)])
