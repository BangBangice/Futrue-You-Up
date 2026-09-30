// The shape of a scenario file. Pure: the server validates with it, and a scenario editor can reuse it.
// It covers the cast, the channels and the starting content; personas, the timeline and checks are still code.
import { z } from 'zod'
import { APP_IDS, COLS, FOLDERS, PRIORITIES } from './types.ts'

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

export const Scenario = z.object({
  id: key,
  title: line,
  /** The cast member the player plays. */
  player: line,
  cast: z.record(key, z.object({ name: line, init: line, color: z.string().regex(/^#[0-9a-f]{6}$/i, 'a #rrggbb colour'), email: line, title: line })),
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
}).superRefine((s, ctx) => {
  const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  const unique = (what: string, ids: (string | number)[], path: string[]) => ids.forEach((id, i) => { if (ids.indexOf(id) !== i) bad([...path, i, 'id'], `duplicate ${what} id "${id}"`) })
  const { emails, chats, unread, tickets, docs } = s.seed

  const who = (id: string | null, path: (string | number)[]) => { if (id !== null && !Object.hasOwn(s.cast, id)) bad(path, `no cast member with id "${id}"`) }
  who(s.player, ['player'])
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

  const docIds = new Set(docs.map(d => d.id)), ticketIds = new Set(tickets.map(t => t.id))
  const check = (files: z.infer<typeof attachment>[] | undefined, path: (string | number)[]) => files?.forEach((a, i) => {
    if (a.kind === 'doc' && !docIds.has(a.doc)) bad([...path, i], `no doc with id "${a.doc}"`)
    if (a.kind === 'ticket' && !ticketIds.has(a.id)) bad([...path, i], `no ticket with id "${a.id}"`)
    if (a.kind === 'link' && a.chan && !Object.hasOwn(s.channels, a.chan)) bad([...path, i], `no channel with id "${a.chan}"`)
  })
  emails.forEach((e, i) => check(e.files, ['seed', 'emails', i, 'files']))
  for (const [c, msgs] of Object.entries(chats)) msgs.forEach((m, i) => check(m.files, ['seed', 'chats', c, i, 'files']))
  // Wiki pages link to each other as [text](doc:id).
  docs.forEach((d, i) => { for (const [, id] of d.body.matchAll(/\]\(doc:([^)\s]+)\)/g)) if (!docIds.has(id)) bad(['seed', 'docs', i, 'body'], `links to missing doc "${id}"`) })
})
export type Scenario = z.infer<typeof Scenario>
