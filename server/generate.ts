// Lessons written by the AI from an author's description, and revised by it on request. Every draft it writes still plays on the one
// code workspace there is (workspace-template/ledgerly-api), so it may rewrite the story around the code but not the code's side of it.
import { Router } from 'express'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { Scenario } from '../shared/scenario.ts'
import { ask, mode } from './ai/llm.ts'
import { Refused, author, createLesson, latest, owned, roomForOne, saveDraft, who } from './authoring.ts'
import { db } from './db/index.ts'
import { lessonGenerations } from './db/schema.ts'
import { DEFAULT_SCENARIO, scenarioFile } from './scenarios.ts'

export const DAILY_GENERATIONS = 10
export const MAX_PROMPT = 2000

// ---------- what stays tied to the code ----------
const LEDGERLY = scenarioFile(DEFAULT_SCENARIO)!
/** Copied from Ledgerly over whatever the model writes. The checks are what server/acceptance.ts runs against the workspace; the
 * customers, alarm and clock are how a failing check turns into the incident; the player and mentor are ids the engine names. */
const FIXED = ['checks', 'customers', 'alarmPercent', 'clock', 'player', 'mentor'] as const
/** The ticket for the bug in the workspace's code. The engine closes and reopens it by this id. */
const CODE_TICKET = 'LED-214'
/** Ids the engine refers to (director.ts, ai/personas.ts, src/sim/guide.ts). They may be renamed and re-voiced, not removed. */
const KEEP_CAST = Object.keys(LEDGERLY.cast), KEEP_CHANNELS = Object.keys(LEDGERLY.channels)

/** The model's lesson, with the code's side put back. Anything not an object is left for validation to refuse. */
function anchor(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = { ...raw }
  for (const k of FIXED) out[k] = structuredClone(LEDGERLY[k])
  const seed = out.seed as { tickets?: unknown } | undefined
  if (seed && typeof seed === 'object' && Array.isArray(seed.tickets)) {
    const ticket = structuredClone(LEDGERLY.seed.tickets.find(t => t.id === CODE_TICKET)!)
    const others = seed.tickets.filter(t => (t as { id?: unknown })?.id !== CODE_TICKET)
    out.seed = { ...seed, tickets: [ticket, ...others] }
  }
  return out
}
/** What a lesson on the Ledgerly workspace must keep, in the words the repair prompt and a 422 use. */
function missing(spec: Scenario): string[] {
  return [
    ...KEEP_CAST.filter(id => !Object.hasOwn(spec.cast, id)).map(id => `cast: keep the member with id "${id}" (rename or re-voice them instead)`),
    ...KEEP_CHANNELS.filter(id => !Object.hasOwn(spec.channels, id)).map(id => `channels: keep the channel with id "${id}"`),
  ]
}
/** The lesson, or what is wrong with it. */
function validate(raw: unknown, id: string): { spec: Scenario } | { problems: string } {
  let value = raw
  if (typeof value === 'string') {
    const text = value.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')
    try { value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch (e) { return { problems: `The answer is not valid JSON: ${(e as Error).message}` } }
  }
  const anchored = anchor(value)
  if (!anchored || typeof anchored !== 'object') return { problems: 'The answer must be one JSON object: the whole lesson.' }
  const parsed = Scenario.safeParse({ ...anchored, id })
  if (!parsed.success) return { problems: z.prettifyError(parsed.error) }
  const gaps = missing(parsed.data)
  return gaps.length ? { problems: gaps.map(g => '✖ ' + g).join('\n') } : { spec: parsed.data }
}

// ---------- the prompt ----------
const SCHEMA = JSON.stringify(z.toJSONSchema(Scenario, { io: 'input', unrepresentable: 'any' }))
const SYSTEM = `You write lessons for LARP, a workplace simulator. A lesson is a shift at a software company: a player joins a team, colleagues (AI personas) message them, and they fix a bug in a real codebase while email, chat, tickets and docs pull at their attention. A mentor coaches them.

Answer with the whole lesson as ONE JSON object matching the JSON Schema below, by calling save_lesson. No prose.

The code is fixed. Every lesson runs on the same codebase: the Ledgerly auth-api, whose bug is ticket ${CODE_TICKET} (SSO users logged out after a token refresh, in src/auth/verifySession.ts). So:
- You may change: title, summary, tags, company, playerBrief, levels, the cast's names, titles, colours, emails and personas, channels' labels and topics, seed emails, chats, unread counts, tickets other than ${CODE_TICKET}, docs, triggers and guide. You may add cast members, channels, emails, tickets, docs, triggers and guide steps.
- Do not change: ${FIXED.join(', ')}, or ticket ${CODE_TICKET}. The server copies them from the example, so leave them out or copy them unchanged.
- Keep these cast ids: ${KEEP_CAST.join(', ')}. Keep these channel ids: ${KEEP_CHANNELS.join(', ')}. The engine refers to them.
- Engine lines still name Priya (priya), Daniel (daniel), Leo (leo), Marta and Northwind Freight, and talk about the auth service, logins and a 3:00 PM demo. Keep the story consistent with that.

Rules the schema can't show:
- Every person a message, email, ticket, doc or trigger names is a cast id; every channel is a channels id. seed.chats and seed.unread have an entry for every channel, and only for channels.
- The mentor has a persona and a DM channel with their id. Every persona's "can" includes "do_nothing"; its rooms are channel ids.
- Ids are unique within emails, tickets, docs, chat messages (numbers below 1000), triggers and guide steps. Attachments and guide targets name existing emails, docs, tickets and channels. Docs link to each other as [text](doc:id).
- In trigger text, the only placeholders are {{now}}, {{deployTime}}, {{deployTimePlus1}}, {{timeToDemo}} and {{player}} (the player's first name). Use {{player}}, not a name, for the player.
- A trigger with "if": {"incident": "still-open"} must be "on": "incident.opened". A security check's share is 0.

JSON Schema:
${SCHEMA}

A complete example, the Ledgerly lesson:
${JSON.stringify(LEDGERLY)}`

const SAVE = {
  name: 'save_lesson', description: 'Save the whole lesson.',
  parameters: { type: 'object' as const, properties: { spec: { type: 'object', description: 'The whole lesson, matching the schema.' } }, required: ['spec'] },
}

export interface Brief { prompt: string; base?: Scenario; system: string; user: string }
/** The model's answer (an object, or text holding one), or null when it isn't answering. Swapped out by the checks. */
export const model = {
  write: async (r: Brief): Promise<unknown> => {
    if (mode() === 'stub') return stub(r.prompt, r.base)
    const calls = await ask({ system: r.system, user: r.user, tools: [SAVE], priority: 2, timeoutMs: 180_000, maxTokens: 16_000 })
    const call = calls?.find(c => c.name === SAVE.name) ?? calls?.find(c => c.name === '_text')
    return call ? call.args.spec ?? call.args.text ?? null : null
  },
}
/** Without a model: Ledgerly, or the draft, lightly changed so the prompt shows. Deterministic, for the checks. */
function stub(prompt: string, base?: Scenario): Scenario {
  const words = prompt.trim().replace(/\s+/g, ' ')
  const s = structuredClone(base ?? LEDGERLY)
  if (!base) {
    const short = words.length > 60 ? words.slice(0, 60).replace(/\s+\S*$/, '') : words
    s.title = (short[0].toUpperCase() + short.slice(1)).replace(/[.,;:\s]+$/, '')
    s.tags = [...(s.tags ?? []), 'ai-draft']
  }
  s.summary = (base ? `Revised: ${words}` : words).slice(0, 200)
  return s
}

async function write(prompt: string, id: string, base?: Scenario): Promise<Scenario> {
  const user = base
    ? `Here is the current lesson:\n${JSON.stringify(base)}\n\nRevise it as the author asks, and answer with the whole revised lesson:\n${prompt}`
    : `Write a new lesson. The author describes it as:\n${prompt}`
  const first = await model.write({ prompt, base, system: SYSTEM, user })
  if (first === null) throw new Refused(503, 'The AI is not answering right now. Try again in a minute.')
  const tried = validate(first, id)
  if ('spec' in tried) return tried.spec
  // One repair round-trip with the errors.
  const answer = typeof first === 'string' ? first : JSON.stringify(first)
  const again = await model.write({ prompt, base, system: SYSTEM, user: `${user}\n\nYour previous answer:\n${answer}\n\nIt was refused for these problems. Fix them and answer with the whole lesson again:\n${tried.problems}` })
  const fixed = again === null ? tried : validate(again, id)
  if ('spec' in fixed) return fixed.spec
  throw new Refused(422, `The AI wrote a lesson that doesn't fit the format, even after a second try. Try again, or describe it differently.\n${fixed.problems}`)
}

// ---------- the daily quota ----------
const today = () => new Date().toISOString().slice(0, 10)
const resetsAt = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString() }
export async function generations(userId: string) {
  const [row] = await db().select({ n: lessonGenerations.count }).from(lessonGenerations)
    .where(and(eq(lessonGenerations.userId, userId), eq(lessonGenerations.day, today())))
  return { remaining: Math.max(0, DAILY_GENERATIONS - (row?.n ?? 0)), limit: DAILY_GENERATIONS, resetsAt: resetsAt() }
}
/** Takes one of today's generations, or refuses. One statement, so parallel requests can't overspend. */
async function spend(userId: string) {
  const day = today()
  const [row] = await db().insert(lessonGenerations).values({ userId, day, count: 1 })
    .onConflictDoUpdate({ target: [lessonGenerations.userId, lessonGenerations.day], set: { count: sql`${lessonGenerations.count} + 1` }, where: sql`${lessonGenerations.count} < ${DAILY_GENERATIONS}` })
    .returning({ n: lessonGenerations.count })
  if (!row) {
    const hours = Math.ceil((Date.parse(resetsAt()) - Date.now()) / 3_600_000)
    throw new Refused(429, `You've used all ${DAILY_GENERATIONS} AI generations for today. They reset at midnight UTC, in about ${hours} hour${hours === 1 ? '' : 's'}.`)
  }
  return day
}
const refund = (userId: string, day: string) => db().update(lessonGenerations).set({ count: sql`greatest(${lessonGenerations.count} - 1, 0)` })
  .where(and(eq(lessonGenerations.userId, userId), eq(lessonGenerations.day, day)))

/** Writes a new draft from the prompt, or with a lesson id revises that lesson's latest version into a draft. A try counts against
 * the quota whether or not the model's lesson passes, since the model ran either way; one the model never answered doesn't. */
export async function generate(userId: string, raw: { prompt?: unknown; lessonId?: unknown }) {
  await author(userId)
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  if (!prompt) throw new Refused(400, 'Describe the lesson you want.')
  if (prompt.length > MAX_PROMPT) throw new Refused(400, `Keep the description under ${MAX_PROMPT} characters.`)
  const id = raw.lessonId === undefined || raw.lessonId === null ? null : String(raw.lessonId)
  if (id) await owned(userId, id)
  else await roomForOne(userId)
  const base = id ? (await latest(id))!.spec as Scenario : undefined
  const day = await spend(userId)
  let spec: Scenario
  try { spec = await write(prompt, id ?? 'new-lesson', base) } catch (e) {
    if (e instanceof Refused && e.status === 503) await refund(userId, day)
    throw e
  }
  return id ? saveDraft(userId, id, spec, prompt) : createLesson(userId, spec, prompt)
}

// ---------- routes: /api/my/lessons/generate, before the lessons routes so /generate isn't read as a lesson id ----------
export const generateApi = Router()
generateApi.get('/generate', async (_req, res) => { res.json(await generations(who(res))) })
generateApi.post('/generate', async (req, res) => {
  const me = who(res)
  try {
    const lesson = await generate(me, req.body ?? {})
    res.status(req.body?.lessonId ? 200 : 201).json({ lesson, generations: await generations(me) })
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    res.status(e.status).json({ error: e.message, ...e.extra, generations: await generations(me) })
  }
})
