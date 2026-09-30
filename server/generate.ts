// Lessons written by the AI from an author's description, and revised by it on request. Every draft plays on the one code
// workspace there is (workspace-template/ledgerly-api). Most are practice lessons with a goal of their own (git, code review, a
// client email…), modelled on scenarios/git-101.json. One kind is the incident shift, modelled on Ledgerly: that one keeps the
// code's side of the story (its bug, checks and customers) and may rewrite only what is around it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { Scenario } from '../shared/scenario.ts'
import { mode, stream } from './ai/llm.ts'
import { Refused, author, createLesson, latest, owned, roomForOne, saveDraft, who } from './authoring.ts'
import { db } from './db/index.ts'
import { lessonGenerations } from './db/schema.ts'
import { DEFAULT_SCENARIO, scenarioFile } from './scenarios.ts'

export const DAILY_GENERATIONS = 10
export const MAX_PROMPT = 2000

// ---------- what stays tied to the code ----------
const LEDGERLY = scenarioFile(DEFAULT_SCENARIO)!
/** The example practice lesson. */
const PRACTICE = scenarioFile('git-101')!
/** Copied from Ledgerly over whatever the model writes. The checks are what server/acceptance.ts runs against the workspace; the
 * customers' figures, alarm and clock are how a failing check turns into the incident; the player and mentor are ids the engine names. */
const FIXED = ['checks', 'customers', 'alarmPercent', 'clock', 'player', 'mentor'] as const
/** What the model may change about a customer: what they are called. Their figures stay Ledgerly's, in the same order. */
const RENAMEABLE = ['name', 'short', 'note'] as const
/** The ticket for the bug in the workspace's code. The engine closes and reopens it by this id. */
const CODE_TICKET = 'LED-214'
/** Ids the engine refers to (director.ts, ai/personas.ts, src/sim/guide.ts). They may be renamed and re-voiced, not removed. */
const KEEP_CAST = Object.keys(LEDGERLY.cast), KEEP_CHANNELS = Object.keys(LEDGERLY.channels)

/** Which kind of lesson a description asks for. The incident shift only when it talks about production going wrong: the rest,
 * git included, is a practice lesson. A revision keeps the kind of the lesson it revises. */
const INCIDENT = /\b(incidents?|outages?|on-?call|in production|prod|deploy(s|ed|ing|ment)?|roll ?back|rollbacks?|sso|led-214|post-?mortems?|alarms?|hotfix|cloudwatch|downtime)\b/i
export type Kind = 'practice' | 'incident'
export const kindOf = (prompt: string, base?: Scenario): Kind => (base ? (base.goal ? 'practice' : 'incident') : INCIDENT.test(prompt) ? 'incident' : 'practice')

/** The model's lesson, with the code's side put back for the incident shift. Anything not an object is left for validation to refuse. */
function anchor(raw: unknown, kind: Kind): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = { ...raw }
  if (kind === 'practice') {
    // No production: nothing of the incident's is used, so none of it is kept, whatever the model copied from where.
    for (const k of ['checks', 'customers', 'alarmPercent'] as const) delete out[k]
    return out
  }
  delete out.goal
  const theirs = (raw as { customers?: { named?: unknown } }).customers?.named
  for (const k of FIXED) out[k] = structuredClone(LEDGERLY[k])
  if (Array.isArray(theirs)) (out.customers as Scenario['customers']).named.forEach((c, i) => {
    const t = theirs[i] as Record<string, unknown> | undefined
    for (const k of RENAMEABLE) if (typeof t?.[k] === 'string') c[k] = t[k] as string
  })
  const seed = out.seed as { tickets?: unknown } | undefined
  if (seed && typeof seed === 'object' && Array.isArray(seed.tickets)) {
    const ticket = structuredClone(LEDGERLY.seed.tickets.find(t => t.id === CODE_TICKET)!)
    const others = seed.tickets.filter(t => (t as { id?: unknown })?.id !== CODE_TICKET)
    out.seed = { ...seed, tickets: [ticket, ...others] }
  }
  return out
}
/** What a lesson of this kind must have, in the words the repair prompt and a 422 use. */
function missing(spec: Scenario, kind: Kind): string[] {
  if (kind === 'practice') return []
  return [
    ...KEEP_CAST.filter(id => !Object.hasOwn(spec.cast, id)).map(id => `cast: keep the member with id "${id}" (rename or re-voice them instead)`),
    ...KEEP_CHANNELS.filter(id => !Object.hasOwn(spec.channels, id)).map(id => `channels: keep the channel with id "${id}"`),
  ]
}
/** The lesson, or what is wrong with it. */
function validate(raw: unknown, id: string, kind: Kind): { spec: Scenario } | { problems: string } {
  let value = raw
  if (typeof value === 'string') {
    const text = value.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')
    try { value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch (e) { return { problems: `The answer is not valid JSON: ${(e as Error).message}` } }
  }
  const anchored = anchor(value, kind)
  if (!anchored || typeof anchored !== 'object') return { problems: 'The answer must be one JSON object: the whole lesson.' }
  // Without it the schema reads the lesson as the incident shift, and its complaints would send the model the wrong way.
  if (kind === 'practice' && !(anchored as { goal?: unknown }).goal) return { problems: '✖ goal: a practice lesson needs a goal: { "title": ..., "summary": ... }' }
  const parsed = Scenario.safeParse({ ...anchored, id })
  if (!parsed.success) return { problems: z.prettifyError(parsed.error) }
  const gaps = missing(parsed.data, kind)
  return gaps.length ? { problems: gaps.map(g => '✖ ' + g).join('\n') } : { spec: parsed.data }
}

// ---------- the prompts ----------
const SCHEMA = JSON.stringify(z.toJSONSchema(Scenario, { io: 'input', unrepresentable: 'any' }))
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'workspace-template', 'ledgerly-api')
const README = readFileSync(join(TEMPLATE, 'README.md'), 'utf8')
const FILES = ['README.md', 'package.json', 'tsconfig.json', 'src/config.ts', 'src/http.ts', 'src/keys.ts', 'src/server.ts', 'src/routes/invoices.ts',
  'src/auth/apiKeyAuth.ts', 'src/auth/jwt.ts', 'src/auth/passwordLogin.ts', 'src/auth/passwords.ts', 'src/auth/verifySession.ts', 'src/sso/idp.ts', 'src/sso/refresh.ts',
  'src/test/helpers.ts', 'src/auth/*.test.ts, src/sso/refresh.test.ts (node:test)']
const FORMAT = 'Answer with the whole lesson as ONE JSON object matching the JSON Schema below, and nothing else: no prose, no code fences. Write the top-level keys in the order the example uses, title first.'
const RULES = `Rules the schema can't show:
- Every person a message, email, ticket, doc or trigger names is a cast id; every channel is a channels id. seed.chats and seed.unread have an entry for every channel, and only for channels.
- The mentor has a persona and a DM channel with their id. Every persona's "can" includes "do_nothing"; its rooms are channel ids.
- Ids are unique within emails, tickets, docs, chat messages (numbers below 100), triggers and guide steps. Attachments and guide targets name existing emails, docs, tickets and channels. Docs link to each other as [text](doc:id).
- In any text, {{player}} is the player's first name. Use it, not a name, for the player. In trigger text the other placeholders are {{now}}, {{deployTime}}, {{deployTimePlus1}} and {{timeToDemo}}.`

const PRACTICE_SYSTEM = `You write lessons for LARP, a workplace simulator that teaches the skills of a software job by doing them. The learner sits at a simulated work computer: VS Code with a real git repository and a terminal, Outlook, Teams, Jira and Confluence. They work through the lesson's steps while a mentor, an AI persona, coaches them over chat. The steps list in the corner ticks each one off as it is done.

${FORMAT}

Write a practice lesson: one with a "goal". It teaches the skill the author describes, and only that. Keep it to what the author asked for.
- title: says what the learner practises, like "Git 101: your first commit, start to finish". Never mention SSO, LED-214, outages or a bug unless the author did.
- goal: { title, summary }. The heading of the step list and one line under it.
- steps (guide): 4 to 12, in order, each one small concrete thing the learner does, with doneWhen saying how the simulator knows it is done. Give a hint where a beginner would get stuck, and showMe where to look.
- cast: the player, the mentor, and only the people the lesson needs. A lesson about one skill usually needs no one else. Every other person must have a reason to be there.
- channels: the mentor's DM, plus a team channel only if a step or message uses it.
- seed: an email or chat message from the mentor that sets the task, the docs the steps need (a short how-to page is usually worth it), a ticket for the task if it helps. No clutter.
- triggers: optional, all "on": "start". A mentor check-in after 20 to 30 minutes is a good one.
- clock.start is when the lesson starts; leave clock.deadline out unless the author wants one. story needs only weekday, date and day.
- levels: how the mentor pitches to each kind of learner, for this skill.
- Leave out checks, customers and alarmPercent: those are for the incident shift. No trigger may run on an incident.

What doneWhen can check (exactly one key per condition; all, any and not combine them):
- ran: a terminal command they ran, or its start: "git status", "git diff", "git log", "npm test". It matches anything that starts with it ("git diff" is also done by "git diff --staged"), so make it specific enough to tell steps apart and no more: a step for git diff --staged uses "git diff --staged", but a test run is "npm test", since learners type paths differently.
- git: "branched" (they have a branch other than main), "staged" (they staged something, or committed), "committed" (they made a commit), "pushed" (they pushed a branch of theirs to origin). These stay done once reached.
- code: "changed" (saved edits not yet committed), "tested" (ran the tests). openedFile: a file path. openedDoc, mailRead, mailReplied: an id. channelRead: a channel id. posted: { chan, who } (who is the player's cast id when they must write there). ticket: { id, status: [...] } (list only the statuses that mean the step is done, never the one it starts in). commented: a ticket id, when they must write on it.
- A step like "commit your change" is done when { "all": [{ "git": "committed" }, { "not": { "code": "changed" } }] }. "Make your change and save it" is { "any": [{ "code": "changed" }, { "git": "committed" }] }.
showMe: { mail | reply | ticket | doc | chat | file | edit: an id or path } or { vscode: "terminal" | "run-tests" | "commit" }.

The repository is the same for every lesson: ${PRACTICE.workspace.repo}, an invoicing service's API in TypeScript (auth, SSO sign-in, invoices) with tests. You may rename it (workspace.repo) and the laptop (workspace.host). The learner starts on main, which tracks origin/main. git push works against origin, except to main, which is protected (changes reach it through a pull request). git merge, switch, checkout, branch, restore, stash, reset, revert and log work as usual. Files: ${FILES.join(', ')}. Steps may ask them to edit, create or read any of these. A good small change for a beginner is to the README. The README is:
"""
${README}"""

${RULES}

JSON Schema:
${SCHEMA}

A complete example, the Git 101 lesson:
${JSON.stringify(PRACTICE)}`

const INCIDENT_SYSTEM = `You write lessons for LARP, a workplace simulator. This kind of lesson is the incident shift: a player joins a team, colleagues (AI personas) message them, and they fix a bug in a real codebase while email, chat, tickets and docs pull at their attention. A mentor coaches them.

${FORMAT}

The code is fixed. Every incident shift runs on the same codebase: an invoicing service's auth-api (the example calls it ledgerly-api), whose bug is ticket ${CODE_TICKET} (SSO users logged out after a token refresh, in src/auth/verifySession.ts). The repository's files, and the ids and paths inside them, stay as they are whatever the lesson calls things. So:
- You may change: title, summary, tags, company, playerBrief, levels, the cast's names, pronouns ("she", "he" or "they"; they when left out), titles, colours, emails and personas, channels' labels and topics, seed emails, chats, unread counts, tickets other than ${CODE_TICKET}, docs, triggers and guide. You may add cast members, channels, emails, tickets, docs, triggers and guide steps.
- You may also change the labels around the code and the incident: workspace.repo (the repository's name) and workspace.host (the work laptop's name); customers' ${RENAMEABLE.join(', ')} (keep their order, figures come from the example); and story, which is how the engine's own lines tell the outage: story.client (the cast id of the client contact who escalates), story.customer (their company, one of the customers' names), story.staff (who there signs in with a password), story.deadline (what happens at the clock's deadline, e.g. "renewal demo"), story.movedTo, story.weekday (the day the shift happens, a day's name such as "Tuesday"), story.date (its month and day, as in "Sep 29"), story.day (which day of the five-day placement, 1 to 5), story.integrations (what breaks for API-key customers) and story.postponed (the email sent when production is down at the deadline).
- Do not change: ${FIXED.join(', ')} (apart from the customers' names above), or ticket ${CODE_TICKET}. The server copies them from the example, so leave them out or copy them unchanged. Leave out "goal": that is for practice lessons.
- Keep these cast ids: ${KEEP_CAST.join(', ')}. Keep these channel ids: ${KEEP_CHANNELS.join(', ')}. The engine refers to them by id and reads their names from the cast, so rename them freely: priya is the manager who assigns ${CODE_TICKET} and gets the postmortem, the mentor is the senior engineer, leo is a peer who asks for help, and the engine posts as cloudwatch and jira.
- Engine lines still talk about the auth service (auth-api, deployed with the ldg command), logins, invoices, Jira, Confluence, CloudWatch and a demo at the clock's deadline. Keep the story consistent with that.

${RULES}
- A trigger with "if": {"incident": "still-open"} must be "on": "incident.opened". A security check's share is 0.

JSON Schema:
${SCHEMA}

A complete example, the Ledgerly lesson:
${JSON.stringify(LEDGERLY)}`

/** How long each kind of lesson usually is, in characters, so progress can be shown as a share of it. */
const USUAL = { practice: JSON.stringify(PRACTICE).length, incident: JSON.stringify(LEDGERLY).length }

// ---------- progress ----------
/** Where a generation has got to, for the author watching it. `chars` is how much of the lesson is written so far. */
export type Phase = 'queued' | 'writing' | 'checking' | 'repairing' | 'saving'
export interface Progress { phase: Phase; kind: Kind; chars: number; usual: number; peek: Peek; problems?: number }
/** What the half-written lesson already says, pulled out as it is written: its title, goal, people, emails and steps. */
export interface Peek { title?: string; goal?: string; people: string[]; emails: string[]; steps: string[] }
const strings = (text: string, key: string) => [...text.matchAll(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g'))]
  .flatMap(m => { try { return [JSON.parse(`"${m[1]}"`) as string] } catch { return [] } })
/** The text between one key and the next, where the model keeps to the example's order. */
const section = (text: string, from: string, to: string[]) => {
  const start = text.indexOf(`"${from}"`)
  if (start < 0) return ''
  const ends = to.map(k => text.indexOf(`"${k}"`, start + 1)).filter(i => i > start)
  return text.slice(start, ends.length ? Math.min(...ends) : undefined)
}
export function peek(text: string): Peek {
  const top = text.slice(0, Math.max(0, text.indexOf('"company"')) || text.length)
  const goal = section(text, 'goal', ['company', 'player', 'levels'])
  return {
    title: strings(top, 'title')[0], goal: goal ? strings(goal, 'title')[0] : undefined,
    people: strings(section(text, 'cast', ['channels', 'seed']), 'name'),
    emails: strings(section(text, 'emails', ['chats', 'unread', 'tickets']), 'subject'),
    steps: strings(section(text, 'guide', ['levels', 'triggers', 'cast']), 'text'),
  }
}

export interface Brief { prompt: string; base?: Scenario; kind: Kind; system: string; user: string }
/** The model's answer (an object, or text holding one), or null when it isn't answering. `onText` hears the answer as it is
 * written. Swapped out by the checks. */
export const model = {
  write: async (r: Brief, onText: (text: string) => void = () => {}): Promise<unknown> => {
    if (mode() === 'stub') return stub(r.prompt, r.kind, r.base)
    return stream({ system: r.system, user: r.user, priority: 2, timeoutMs: 240_000, maxTokens: r.kind === 'incident' ? 24_000 : 16_000 }, onText)
  },
}
/** Without a model: the example, or the draft, lightly changed so the prompt shows. Deterministic, for the checks. */
function stub(prompt: string, kind: Kind, base?: Scenario): Scenario {
  const words = prompt.trim().replace(/\s+/g, ' ')
  const s = structuredClone(base ?? (kind === 'practice' ? PRACTICE : LEDGERLY))
  if (!base) {
    const short = words.length > 60 ? words.slice(0, 60).replace(/\s+\S*$/, '') : words
    s.title = (short[0].toUpperCase() + short.slice(1)).replace(/[.,;:\s]+$/, '')
    s.tags = [...(s.tags ?? []), 'ai-draft']
  }
  s.summary = (base ? `Revised: ${words}` : words).slice(0, 200)
  return s
}

async function write(prompt: string, id: string, base: Scenario | undefined, tell: (p: Progress) => void): Promise<Scenario> {
  const kind = kindOf(prompt, base), usual = USUAL[kind]
  const system = kind === 'practice' ? PRACTICE_SYSTEM : INCIDENT_SYSTEM
  const user = base
    ? `Here is the current lesson:\n${JSON.stringify(base)}\n\nRevise it as the author asks, and answer with the whole revised lesson:\n${prompt}`
    : `Write a new lesson. The author describes it as:\n${prompt}`
  // Told at most every half second: a lesson arrives in thousands of small pieces.
  let last = 0
  const watch = (phase: Phase, problems?: number) => (text: string) => {
    if (Date.now() - last < 500) return
    last = Date.now()
    tell({ phase, kind, chars: text.length, usual, peek: peek(text), problems })
  }
  tell({ phase: 'queued', kind, chars: 0, usual, peek: peek('') })
  const first = await model.write({ prompt, base, kind, system, user }, watch('writing'))
  if (first === null) throw new Refused(503, 'The AI is not answering right now. Try again in a minute.')
  const answer = typeof first === 'string' ? first : JSON.stringify(first)
  tell({ phase: 'checking', kind, chars: answer.length, usual, peek: peek(answer) })
  const tried = validate(first, id, kind)
  if ('spec' in tried) return tried.spec
  // One repair round-trip with the errors.
  const problems = tried.problems.split('\n').filter(l => l.startsWith('✖')).length || 1
  last = 0
  tell({ phase: 'repairing', kind, chars: 0, usual, peek: peek(answer), problems })
  const again = await model.write({ prompt, base, kind, system, user: `${user}\n\nYour previous answer:\n${answer}\n\nIt was refused for these problems. Fix them and answer with the whole lesson again:\n${tried.problems}` }, watch('repairing', problems))
  const fixed = again === null ? tried : validate(again, id, kind)
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
 * the quota whether or not the model's lesson passes, since the model ran either way; one the model never answered doesn't.
 * `tell` hears how far it has got. The draft is saved even if nobody is listening by then. */
export async function generate(userId: string, raw: { prompt?: unknown; lessonId?: unknown }, tell: (p: Progress) => void = () => {}) {
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
  try { spec = await write(prompt, id ?? 'new-lesson', base, tell) } catch (e) {
    if (e instanceof Refused && e.status === 503) await refund(userId, day)
    throw e
  }
  tell({ phase: 'saving', kind: kindOf(prompt, base), chars: JSON.stringify(spec).length, usual: USUAL[kindOf(prompt, base)], peek: peek(JSON.stringify(spec)) })
  return id ? saveDraft(userId, id, spec, prompt) : createLesson(userId, spec, prompt)
}

// ---------- routes: /api/my/lessons/generate, before the lessons routes so /generate isn't read as a lesson id ----------
// Asked for with Accept: application/x-ndjson, the answer is a stream of lines, one JSON object each: { progress } as the lesson
// is written, then { lesson, generations } or { error, status, generations }. Otherwise it is one JSON answer at the end.
export const generateApi = Router()
generateApi.get('/generate', async (_req, res) => { res.json(await generations(who(res))) })
generateApi.post('/generate', async (req, res) => {
  const me = who(res)
  const status = req.body?.lessonId ? 200 : 201
  if (String(req.headers.accept).includes('application/x-ndjson')) {
    res.status(status).set({ 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }).flushHeaders()
    const line = (o: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n') }
    // Proxies close a response that goes quiet, and a model can think for a while before writing anything.
    const beat = setInterval(() => line({ beat: true }), 10_000)
    try {
      const lesson = await generate(me, req.body ?? {}, progress => line({ progress }))
      line({ lesson, generations: await generations(me) })
    } catch (e) {
      if (!(e instanceof Refused)) console.error('[generate]', e)
      const refused = e instanceof Refused ? e : new Refused(500, 'Something went wrong writing the lesson. Try again.')
      line({ error: refused.message, status: refused.status, ...refused.extra, generations: await generations(me).catch(() => undefined) })
    } finally { clearInterval(beat); res.end() }
    return
  }
  try {
    const lesson = await generate(me, req.body ?? {})
    res.status(status).json({ lesson, generations: await generations(me) })
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    res.status(e.status).json({ error: e.message, ...e.extra, generations: await generations(me) })
  }
})
