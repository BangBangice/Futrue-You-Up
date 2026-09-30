import { sql } from 'drizzle-orm'
import { bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

const at = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow()

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  /** Null for a built-in lesson; set null too if its author deletes their account, so the lesson outlives them. */
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  visibility: text('visibility', { enum: ['private', 'unlisted', 'public'] }).notNull().default('private'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  summary: text('summary'),
  /** Set when moderators take the lesson down: it leaves the library and can't be started, but the author keeps it. */
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  hiddenReason: text('hidden_reason'),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
}, t => [index().using('gin', t.tags)])

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

/** AI lesson generations per author per UTC day, for the daily quota. Counted here so a restart doesn't reset it. */
export const lessonGenerations = pgTable('lesson_generations', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  count: integer('count').notNull().default(0),
}, t => [primaryKey({ columns: [t.userId, t.day] })])

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

export const REPORT_REASONS = ['spam', 'offensive', 'broken', 'other'] as const
export const lessonReports = pgTable('lesson_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  scenarioId: text('scenario_id').notNull().references(() => scenarios.id, { onDelete: 'cascade' }),
  reporterId: text('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason', { enum: REPORT_REASONS }).notNull(),
  note: varchar('note', { length: 500 }),
  status: text('status', { enum: ['open', 'resolved', 'dismissed'] }).notNull().default('open'),
  createdAt: at('created_at'),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, t => [
  // One open report per reporter per lesson; once it is closed they may report again.
  uniqueIndex('lesson_reports_one_open').on(t.scenarioId, t.reporterId).where(sql`${t.status} = 'open'`),
  index().on(t.reporterId, t.createdAt),
  index().on(t.status),
])

// Better Auth's tables, matching its schema for better-auth 1.7 with the anonymous and jwt plugins and our `role` field.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isAnonymous: boolean('is_anonymous').default(false),
  role: text('role').notNull().default('learner'),
  /** Set by a moderator. A banned user can't sign in, and their lessons leave the library. */
  bannedAt: timestamp('banned_at', { withTimezone: true }),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
}, t => [index().on(t.userId)])

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
}, t => [index().on(t.userId)])

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: at('created_at'),
  updatedAt: at('updated_at'),
}, t => [index().on(t.identifier)])

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  alg: text('alg'),
  crv: text('crv'),
  createdAt: at('created_at'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})
