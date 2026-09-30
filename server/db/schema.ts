import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

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

// Better Auth's tables, matching its schema for better-auth 1.7 with the anonymous and jwt plugins and our `role` field.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isAnonymous: boolean('is_anonymous').default(false),
  role: text('role').notNull().default('learner'),
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
