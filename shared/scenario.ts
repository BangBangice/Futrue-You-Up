// The shape of a scenario file. Pure: the server validates with it, and a scenario editor can reuse it.
// Data: the company, the cast with each AI colleague's persona card, the mentor and how they pitch to each level, the channels, the starting content and the scripted triggers.
// Also data: the clock, the production checks' labels and what each costs, and the customers.
// Also data: what the code workspace is called, and the words the engine uses for the client, the deadline and the outage (story).
// Still code: what the checks test (server/acceptance.ts), the facts each persona is told, the mentor's rules and scripted fallback lines.
import { z } from 'zod'
import { DONE_KEYS, NEW, SHOW_KEYS } from './guide.ts'
import type { Done, GuideStep } from './guide.ts'
import { normalizeTags } from './tags.ts'
import { APP_IDS, COLS, FOLDERS, LEVELS, PRIORITIES, firstName, initials, minutes } from './types.ts'

const line = z.string().min(1)
const key = z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes')
// Checked against the cast and channels in superRefine below.
const person = line
const chan = line

const attachment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code'), path: line }),
  z.object({ kind: z.literal('doc'), doc: line }),
  z.object({ kind: z.literal('ticket'), id: line }),
  z.object({ kind: z.literal('link'), label: line, app: z.enum(APP_IDS), chan: chan.optional() }),
])

const email = z.object({
  id: line, folder: z.enum(FOLDERS), who: person, toName: z.string().optional(), subject: line, time: line, read: z.boolean().default(false),
  kind: z.enum(['assign', 'support', 'client', 'sam', 'pm']).optional(), flagged: z.boolean().optional(),
  body: z.array(z.string()).min(1), files: z.array(attachment).default([]),
  thread: z.array(z.object({ time: line, text: z.string(), files: z.array(attachment) })).default([]),
})

const chatMsg = z.object({
  id: z.number().int(), who: person, time: line, text: z.string(),
  alert: z.enum(['fire', 'ok', 'info']).optional(), files: z.array(attachment).optional(),
})

const ticket = z.object({
  id: line, title: line, status: z.enum(COLS.map(c => c[0])), who: person.nullable(), pri: z.enum(PRIORITIES), pts: z.number().int().nullable(), desc: z.string(),
  reopened: z.boolean().optional(),
  comments: z.array(z.object({ who: person, time: line, text: line })).default([]),
  activity: z.array(z.object({ time: line, text: line })).default([]),
})

const doc = z.object({ id: line, title: line, group: line, owner: person, updated: line, body: z.string(), version: z.number().int().positive().default(1) })

/** Timestamps in the session's private facts that a trigger may record or test. */
export const FLAGS = ['warnedAt', 'readWarningAt', 'editedAt', 'testedAt', 'leoAskedAt', 'ackAt', 'askedDanielAt', 'clientMailAt', 'clientAt', 'pmAt', 'assignAckAt', 'rolledBackAt', 'fixedAt'] as const
/** Values the engine computes for {{name}} placeholders in trigger text. {{player}} is the player's first name and works in any text. */
export const VARS = ['now', 'deployTime', 'deployTimePlus1', 'timeToDemo', 'player'] as const
export const EVENTS = ['start', 'incident.opened', 'incident.resolved'] as const
const flag = z.enum(FLAGS, { error: i => `no flag "${String(i.input)}"` })
const text = z.string().superRefine((t, ctx) => {
  for (const [p, name] of t.matchAll(/\{\{(.*?)\}\}/g)) if (!(VARS as readonly string[]).includes(name)) ctx.addIssue({ code: 'custom', message: `unknown placeholder "${p}"` })
})

// Conditions and actions are objects with exactly one leading key, not unions, so a mistake is reported at the field that is wrong.
const one = (keys: readonly string[], what: string) => (o: object, ctx: z.RefinementCtx) => {
  const got = Object.keys(o).filter(k => keys.includes(k))
  if (got.length !== 1) ctx.addIssue({ code: 'custom', message: `${what} needs exactly one of ${keys.join(', ')}` })
}
/** Exactly one of all, any, not, flag (with set), incident, shipped, demo. */
export interface Cond {
  all?: Cond[]; any?: Cond[]; not?: Cond
  flag?: typeof FLAGS[number]; set?: boolean
  /** The incident that scheduled this trigger has not been resolved. */
  incident?: 'still-open'
  /** Whether the player has deployed anything yet. */
  shipped?: boolean
  demo?: 'pending' | 'held' | 'postponed'
}
const cond: z.ZodType<Cond> = z.lazy(() => z.strictObject({
  all: z.array(cond).min(1).optional(), any: z.array(cond).min(1).optional(), not: cond.optional(),
  flag: flag.optional(), set: z.boolean().optional(),
  incident: z.literal('still-open').optional(), shipped: z.boolean().optional(), demo: z.enum(['pending', 'held', 'postponed']).optional(),
}).superRefine((c, ctx) => {
  one(['all', 'any', 'not', 'flag', 'incident', 'shipped', 'demo'], 'a condition')(c, ctx)
  if ((c.flag === undefined) !== (c.set === undefined)) ctx.addIssue({ code: 'custom', message: '"flag" and "set" go together' })
}))

const action = z.strictObject({
  post: z.strictObject({ chan, who: person, text: text.min(1), files: z.array(attachment).optional() }).optional(),
  mail: email.omit({ id: true, time: true, read: true, thread: true }).extend({ folder: z.enum(FOLDERS).default('inbox'), subject: text.min(1), toName: text.optional(), body: z.array(text).min(1) }).strict().optional(),
  /** Records the current sim minute. */
  flag: flag.optional(),
}).superRefine(one(['post', 'mail', 'flag'], 'an action'))

const trigger = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]+$/, 'lowercase letters, digits, dashes and underscores'),
  /** Sim minutes after an engine event. */
  when: z.strictObject({ on: z.enum(EVENTS), after: z.number().int().min(0) }),
  if: cond.optional(),
  do: z.array(action).min(1),
})
export type Trigger = z.infer<typeof trigger>

/** What an AI colleague may do. The engine checks every call against the persona's list. */
export const TOOLS = ['send_teams_message', 'send_email', 'comment_on_ticket', 'update_ticket', 'create_page', 'edit_page', 'do_nothing'] as const
export type ToolName = typeof TOOLS[number]
const persona = z.strictObject({
  voice: line, knows: line, wants: line,
  /** Channels they may post in. Their own DM is one of them if they have one. */
  rooms: z.array(chan).default([]),
  can: z.array(z.enum(TOOLS, { error: i => `no tool "${String(i.input)}"` })).min(1),
  /** Works at the company, so their prompt says where they work. */
  internal: z.boolean(),
})
export type Persona = z.infer<typeof persona>
const time = z.string().regex(/^(1[0-2]|[1-9]):[0-5]\d [AP]M$/, 'a time like "1:10 PM"')
const check = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and underscores'), label: line,
  /** Share of traffic (%) that fails when this check does. */
  share: z.number().min(0, 'a share cannot be negative'),
  /** Guards against letting the wrong people in. Its verdict never reaches the browser, and a failure is silent. */
  security: z.boolean().optional(),
  locks: z.enum(['password', 'sso']).optional(),
})
const customer = z.strictObject({
  name: line,
  /** What the story and the production logs call them, like "Northwind". Their name's first word if not given. */
  short: line.optional(),
  arr: line, password: z.number().int().min(0), sso: z.number().int().min(0), note: z.string().default(''),
})
const done: z.ZodType<Done> = z.lazy(() => z.strictObject({
  all: z.array(done).min(1).optional(), any: z.array(done).min(1).optional(), not: done.optional(),
  mailRead: line.optional(), mailReplied: line.optional(),
  ticket: z.strictObject({ id: line, status: z.array(z.enum(COLS.map(c => c[0]))).min(1) }).optional(),
  posted: z.strictObject({ chan, who: person }).optional(), channelRead: chan.optional(),
  openedDoc: line.optional(), openedFile: line.optional(),
  code: z.enum(['changed', 'tested', 'committed']).optional(), deployed: z.boolean().optional(),
}).superRefine(one(DONE_KEYS, 'a step condition')))
const showMe = z.strictObject({
  mail: line.optional(), reply: line.optional(), ticket: line.optional(), chat: chan.optional(), doc: line.optional(),
  file: line.optional(), edit: line.optional(), vscode: z.enum(['run-tests', 'commit', 'deploy']).optional(),
}).superRefine(one(SHOW_KEYS, 'a show-me target'))
const guideStep: z.ZodType<GuideStep> = z.strictObject({
  id: key, text: line, hint: line.optional(),
  levels: z.array(z.enum(LEVELS, { error: i => `no level "${String(i.input)}"` })).min(1).optional(),
  doneWhen: done, showMe: showMe.optional(),
})

/** The one code workspace's labels, as Ledgerly has them. Its contents are fixed (workspace-template/ledgerly-api); only these change. */
export const WORKSPACE = { repo: 'ledgerly-api', host: 'ledgerly-ws-02' }
/** How the engine's own lines tell the story around an outage, as Ledgerly has it. Specs saved before this was data get these. */
export const STORY = {
  client: 'marta', customer: 'Northwind Freight', staff: 'finance contractors', deadline: 'renewal demo', movedTo: 'Thursday',
  integrations: ['Osprey’s nightly export', 'Brightline’s booking sync'],
  postponed: { who: 'sam', subject: 'Northwind demo postponed', body: ['I called Marta and moved the demo to Thursday. She was polite about it, but she asked for a written explanation for their CFO.', 'Sam'] },
}

const level = z.strictObject({ label: line, blurb: line, mentorGuidance: line })

export const Scenario = z.object({
  id: key,
  title: line,
  /** One line for the lesson library. */
  summary: line.max(200).optional(),
  /** What the library filters by. Stored cleaned, so older specs without tags still parse. */
  tags: z.array(z.string()).transform(normalizeTags).optional(),
  company: z.strictObject({ name: line, description: line }),
  /** The cast member the player plays. */
  player: line,
  /** Told to every colleague after the player's name and title. */
  playerBrief: line,
  /** The cast member who coaches the player, in the DM channel that shares their id. */
  mentor: line,
  levels: z.strictObject({ newgrad: level, bootcamp: level, switcher: level }),
  /** When the shift starts, and when the demo is. */
  clock: z.strictObject({ start: time, deadline: time.optional() }),
  /** 401 rate (%) that fires the alarm. */
  alarmPercent: z.number().positive(),
  /** Must match the ids server/acceptance.ts reports, in any order. */
  checks: z.array(check).min(1),
  customers: z.strictObject({ named: z.array(customer), otherAccounts: z.number().int().min(0), otherPasswordUsers: z.number().int().min(0) }),
  workspace: z.strictObject({
    /** The repository's name: VS Code's title, the terminal prompt and pwd, npm test's banner. */
    repo: key,
    /** The work laptop's name, in the menu bar. The terminal prompt drops its first word. */
    host: key,
  }).default(() => ({ ...WORKSPACE })),
  story: z.strictObject({
    /** Cast id of the client contact, who escalates when their people are locked out. */
    client: person,
    /** The client's company: the name of one of customers.named. */
    customer: line,
    /** Who there signs in with a password, as in "Northwind’s 22 finance contractors". */
    staff: line,
    /** What happens at the clock's deadline, as in "Northwind Freight renewal demo". */
    deadline: line,
    /** When it moves to if production is down at the deadline. */
    movedTo: line,
    /** What breaks for API-key customers, as in "Osprey’s nightly export". */
    integrations: z.array(line),
    /** The email sent when production is down at the deadline. */
    postponed: z.strictObject({ who: person, subject: text.min(1), body: z.array(text).min(1) }),
  }).default(() => structuredClone(STORY)),
  /** Only a member with a persona answers the player. */
  cast: z.record(key, z.object({ name: line, short: line.optional(), init: line, color: z.string().regex(/^#[0-9a-f]{6}$/i, 'a #rrggbb colour'), email: line, title: line, persona: persona.optional() })),
  /** A DM channel's id is the id of the person on the other end. */
  channels: z.record(key, z.object({ label: line, topic: z.string(), dm: z.boolean().optional() })),
  seed: z.object({
    emails: z.array(email),
    chats: z.record(chan, z.array(chatMsg)),
    /** Messages already waiting for the player in each channel. */
    unread: z.record(chan, z.number().int().min(0)),
    tickets: z.array(ticket),
    docs: z.array(doc),
  }),
  /** Scripted things that happen on schedule. Order matters for triggers due in the same minute. */
  triggers: z.array(trigger).default([]),
  /** The step list the player starts with, in order. Later phases (after a deploy, during an incident) are still code in src/sim/guide.ts. */
  guide: z.array(guideStep).default([]),
}).superRefine((s, ctx) => {
  const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  const unique = (what: string, ids: (string | number)[], path: string[]) => ids.forEach((id, i) => { if (ids.indexOf(id) !== i) bad([...path, i, 'id'], `duplicate ${what} id "${id}"`) })
  const { emails, chats, unread, tickets, docs } = s.seed

  const who = (id: string | null, path: (string | number)[]) => { if (id !== null && !Object.hasOwn(s.cast, id)) bad(path, `no cast member with id "${id}"`) }
  who(s.player, ['player'])
  who(s.mentor, ['mentor'])
  who(s.story.client, ['story', 'client'])
  who(s.story.postponed.who, ['story', 'postponed', 'who'])
  if (!s.customers.named.some(c => c.name === s.story.customer)) bad(['story', 'customer'], `no customer named "${s.story.customer}"`)
  if (Object.hasOwn(s.cast, s.mentor) && !s.channels[s.mentor]?.dm) bad(['mentor'], `the mentor needs a DM channel with id "${s.mentor}"`)
  if (Object.hasOwn(s.cast, s.mentor) && !s.cast[s.mentor].persona) bad(['mentor'], 'the mentor needs a persona')
  for (const [id, { persona: p }] of Object.entries(s.cast)) {
    p?.rooms.forEach((c, i) => { if (!Object.hasOwn(s.channels, c)) bad(['cast', id, 'persona', 'rooms', i], `no channel with id "${c}"`) })
    if (p && !p.can.includes('do_nothing')) bad(['cast', id, 'persona', 'can'], 'a persona must be able to do_nothing')
  }
  for (const [c, ch] of Object.entries(s.channels)) if (ch.dm) who(c, ['channels', c])
  for (const [field, rec] of [['chats', chats], ['unread', unread]] as const) {
    for (const c of Object.keys(s.channels)) if (!Object.hasOwn(rec, c)) bad(['seed', field], `missing channel "${c}"`)
    for (const c of Object.keys(rec)) if (!Object.hasOwn(s.channels, c)) bad(['seed', field, c], `no channel with id "${c}"`)
  }
  emails.forEach((e, i) => who(e.who, ['seed', 'emails', i, 'who']))
  for (const [c, msgs] of Object.entries(chats)) msgs.forEach((m, i) => who(m.who, ['seed', 'chats', c, i, 'who']))
  tickets.forEach((t, i) => { who(t.who, ['seed', 'tickets', i, 'who']); t.comments.forEach((m, j) => who(m.who, ['seed', 'tickets', i, 'comments', j, 'who'])) })
  docs.forEach((d, i) => who(d.owner, ['seed', 'docs', i, 'owner']))
  unique('email', emails.map(e => e.id), ['seed', 'emails'])
  unique('ticket', tickets.map(t => t.id), ['seed', 'tickets'])
  unique('doc', docs.map(d => d.id), ['seed', 'docs'])
  unique('chat message', Object.values(chats).flat().map(m => m.id), ['seed', 'chats'])
  for (const [c, msgs] of Object.entries(chats)) msgs.forEach((m, i) => { if (m.id >= NEW) bad(['seed', 'chats', c, i, 'id'], `seed message ids must be below ${NEW}`) })

  const docIds = new Set(docs.map(d => d.id)), ticketIds = new Set(tickets.map(t => t.id))
  const check = (files: z.infer<typeof attachment>[] | undefined, path: (string | number)[]) => files?.forEach((a, i) => {
    if (a.kind === 'doc' && !docIds.has(a.doc)) bad([...path, i], `no doc with id "${a.doc}"`)
    if (a.kind === 'ticket' && !ticketIds.has(a.id)) bad([...path, i], `no ticket with id "${a.id}"`)
    if (a.kind === 'link' && a.chan && !Object.hasOwn(s.channels, a.chan)) bad([...path, i], `no channel with id "${a.chan}"`)
  })
  emails.forEach((e, i) => check(e.files, ['seed', 'emails', i, 'files']))
  for (const [c, msgs] of Object.entries(chats)) msgs.forEach((m, i) => check(m.files, ['seed', 'chats', c, i, 'files']))
  s.triggers.forEach((t, i) => t.do.forEach(({ post, mail }, j) => {
    const path = ['triggers', i, 'do', j]
    if (post) {
      if (!Object.hasOwn(s.channels, post.chan)) bad([...path, 'post', 'chan'], `no channel with id "${post.chan}"`)
      who(post.who, [...path, 'post', 'who'])
      check(post.files, [...path, 'post', 'files'])
    }
    if (mail) { who(mail.who, [...path, 'mail', 'who']); check(mail.files, [...path, 'mail', 'files']) }
  }))
  const scoped = (c: Cond | undefined): boolean => !!c && (!!c.incident || !!c.all?.some(scoped) || !!c.any?.some(scoped) || scoped(c.not))
  s.triggers.forEach((t, i) => { if (scoped(t.if) && t.when.on !== 'incident.opened') bad(['triggers', i, 'if'], '"incident": "still-open" only applies to triggers on incident.opened') })
  unique('trigger', s.triggers.map(t => t.id), ['triggers'])
  s.triggers.forEach((t, i) => { if (t.id === 'demo') bad(['triggers', i, 'id'], 'the id "demo" is reserved') })
  unique('check', s.checks.map(c => c.id), ['checks'])
  s.checks.forEach((c, i) => { if (c.security && c.share) bad(['checks', i, 'share'], 'a security check fails silently, so its share must be 0') })
  if (s.clock.deadline && minutes(s.clock.deadline) <= minutes(s.clock.start)) bad(['clock', 'deadline'], 'the deadline must be after the start')
  const demo = (c: Cond | undefined): boolean => !!c && (!!c.demo || !!c.all?.some(demo) || !!c.any?.some(demo) || demo(c.not))
  s.triggers.forEach((t, i) => { if (!s.clock.deadline && (demo(t.if) || JSON.stringify(t.do).includes('{{timeToDemo}}'))) bad(['triggers', i], 'uses the demo, so the clock needs a deadline') })
  const emailIds = new Set(emails.map(e => e.id)), chanIds = new Set(Object.keys(s.channels)), castIds = new Set(Object.keys(s.cast))
  const refs = (path: (string | number)[], pairs: [string, string | undefined, Set<string>][]) => {
    for (const [what, id, ids] of pairs) if (id !== undefined && !ids.has(id)) bad(path, `no ${what} with id "${id}"`)
  }
  const cond = (c: Done, path: (string | number)[]) => {
    c.all?.forEach((x, i) => cond(x, [...path, 'all', i]))
    c.any?.forEach((x, i) => cond(x, [...path, 'any', i]))
    if (c.not) cond(c.not, [...path, 'not'])
    refs(path, [['email', c.mailRead, emailIds], ['email', c.mailReplied, emailIds], ['ticket', c.ticket?.id, ticketIds], ['doc', c.openedDoc, docIds],
      ['channel', c.channelRead, chanIds], ['channel', c.posted?.chan, chanIds], ['cast member', c.posted?.who, castIds]])
  }
  s.guide.forEach((g, i) => {
    cond(g.doneWhen, ['guide', i, 'doneWhen'])
    const m = g.showMe
    if (m) refs(['guide', i, 'showMe'], [['email', m.mail, emailIds], ['email', m.reply, emailIds], ['ticket', m.ticket, ticketIds], ['doc', m.doc, docIds], ['channel', m.chat, chanIds]])
  })
  unique('guide step', s.guide.map(g => g.id), ['guide'])
  // Wiki pages link to each other as [text](doc:id).
  docs.forEach((d, i) => { for (const [, id] of d.body.matchAll(/\]\(doc:([^)\s]+)\)/g)) if (!docIds.has(id)) bad(['seed', 'docs', i, 'body'], `links to missing doc "${id}"`) })
})
export type Scenario = z.infer<typeof Scenario>
/** The customer the client contact works at. The schema makes sure there is one. */
export const clientOf = (s: Scenario) => s.customers.named.find(c => c.name === s.story.customer)!

/**
 * Casts the person playing as the scenario's player: their name on the player's cast card, and in place of {{player}}
 * everywhere else. `short` is what colleagues call them, for names without a first name to take, like a guest's "Happy Mango".
 */
export function personalize(s: Scenario, who: { name: string; short?: string }): Scenario {
  const name = who.name.trim().replace(/\s+/g, ' ').slice(0, 60)
  const base = s.cast[s.player]
  const p = name ? { ...base, name, short: who.short, init: initials(name), email: `${slug(name) || 'you'}@${base.email.split('@')[1]}` } : base
  const call = firstName(p)
  const fill = (v: unknown): unknown => typeof v === 'string' ? v.replaceAll('{{player}}', call)
    : Array.isArray(v) ? v.map(fill)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
    : v
  return fill({ ...s, cast: { ...s.cast, [s.player]: p } }) as Scenario
}
const slug = (name: string) => name.normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '.')
