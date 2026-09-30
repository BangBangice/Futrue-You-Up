// Suggestions while an author describes a lesson: the next few words, shown greyed out and taken with Tab. They push the description
// towards what the lesson writer (generate.ts) needs, so a generation is spent on a fuller idea. Free, unlike generations, so they are
// short, rate-limited per author, and give way to the shift when the model is busy.
import { Router } from 'express'
import { ask, mode } from './ai/llm.ts'
import { Refused, author, latest, owned, who } from './authoring.ts'
import { MAX_PROMPT } from './generate.ts'
import type { Scenario } from '../shared/scenario.ts'

/** Below this there is no idea yet to build on. */
export const MIN_TEXT = 12
const MAX_SUGGESTION = 200
export const PER_MINUTE = 20, PER_DAY = 500

const SYSTEM = `You help an author describe a lesson for LARP, a workplace simulator. A lesson is one shift at a software company: the player joins a team, colleagues message them, email, chat and tickets land over the day, and they fix a bug in the code while all that pulls at their attention. An AI turns the author's description into the whole lesson.

Continue the author's description where it stops, with the next few words or one short sentence (at most 25 words). Build on their idea; never change its direction or contradict it. Add what makes it concrete and easy to turn into a lesson, whichever is still missing: the company and what it sells, who is on the team and how they behave, what arrives in the inbox or chat and when, the deadline, the pressure or twist.

The code is fixed: an auth service where SSO users get logged out after a token refresh. Weave that bug in if it fits; don't invent a different one.

Answer with the exact characters to insert after the text, by calling suggest. If the text stops mid-word, finish that word. If it stops after a full word or punctuation, start with a space. Don't repeat what is already written. Write in the author's language and voice.`

const SUGGEST = {
  name: 'suggest', description: 'The characters to insert after the text.',
  parameters: { type: 'object' as const, properties: { text: { type: 'string' } }, required: ['text'] },
}

/** Tidies what the model returns into something to append: one line, no quotes around it, no echo of the text, a space where one is due. */
export function join(text: string, raw: string): string {
  let s = raw.replace(/\s*\n+\s*/g, ' ').replace(/^(\s*)["“](.*)["”]\s*$/, '$1$2').trimEnd()
  const tail = text.trimEnd()
  // The model sometimes starts by repeating the last words.
  for (let n = Math.min(tail.length, s.trimStart().length); n >= 8; n--) {
    if (s.trimStart().startsWith(tail.slice(-n))) { s = s.trimStart().slice(n); break }
  }
  if (!s.trim()) return ''
  if (/\s$/.test(text)) s = s.trimStart()
  else if (/[.,;:!?…)]$/.test(text) && /^[^\s.,;:!?)]/.test(s)) s = ' ' + s
  return s.length > MAX_SUGGESTION ? s.slice(0, MAX_SUGGESTION).replace(/\s+\S*$/, '') : s
}

/** Without a model: a nudge towards whatever the description still lacks, so the box works offline and in the checks. */
function stub(text: string): string {
  const t = text.toLowerCase(), ended = /[.!?]$/.test(text.trimEnd())
  if (!/(startup|company|bank|shop|agency|fintech|saas)/.test(t)) return join(text, ended ? 'It happens at a small fintech startup.' : ' at a small fintech startup')
  const nudge = !/(email|inbox|message|slack|teams|chat)/.test(t) ? 'Mid-morning, an angry client emails about customers being logged out.'
    : !/(\d|morning|afternoon|noon|deadline|demo|release)/.test(t) ? 'All before a client demo at 3pm.'
    : 'Meanwhile a junior colleague keeps asking for help.'
  return join(text, ended ? nudge : '. ' + nudge)
}

/** The model's continuation. Swapped out by the checks. */
export const model = {
  complete: async (text: string, base?: Scenario): Promise<string | null> => {
    if (mode() === 'stub') return stub(text)
    const about = base ? `They are asking for a change to their lesson "${base.title}": ${base.summary ?? ''}\n\n` : ''
    const calls = await ask({ system: SYSTEM, user: `${about}The author's text so far:\n${text}`, tools: [SUGGEST], priority: 2, timeoutMs: 8_000, maxTokens: 120, optional: true })
    const call = calls?.find(c => c.name === SUGGEST.name) ?? calls?.find(c => c.name === '_text')
    return typeof call?.args.text === 'string' ? call.args.text : null
  },
}

// Per author, in memory: a restart forgives, which is fine for something this cheap.
const asked = new Map<string, number[]>()
function allow(userId: string) {
  const now = Date.now()
  const times = (asked.get(userId) ?? []).filter(t => t > now - 86_400_000)
  if (times.length >= PER_DAY || times.filter(t => t > now - 60_000).length >= PER_MINUTE) throw new Refused(429, 'Slow down: suggestions pause for a moment.')
  times.push(now)
  asked.set(userId, times)
}

/** A suggestion to append to the text, or '' when there is none worth showing. */
export async function complete(userId: string, raw: { text?: unknown; lessonId?: unknown }): Promise<string> {
  await author(userId)
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_PROMPT) : ''
  if (text.trim().length < MIN_TEXT) return ''
  const id = typeof raw.lessonId === 'string' ? raw.lessonId : null
  if (id) await owned(userId, id)
  allow(userId)
  const base = id ? (await latest(id))?.spec as Scenario | undefined : undefined
  const answer = await model.complete(text, base)
  if (!answer) return ''
  const s = join(text, answer)
  return text.length + s.length > MAX_PROMPT ? '' : s
}

// ---------- routes: /api/my/lessons/complete ----------
export const completeApi = Router()
completeApi.post('/complete', async (req, res) => { res.json({ suggestion: await complete(who(res), req.body ?? {}) }) })
