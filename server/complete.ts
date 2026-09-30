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

const SYSTEM = `You help an author describe a lesson for LARP, a workplace simulator that teaches the skills of a software job by doing them. The learner sits at a simulated work computer (a real code repository with git and a terminal, email, team chat, tickets and a wiki), works through a task, and a senior colleague coaches them. A lesson can teach any skill that fits: git basics, reading code, testing, debugging, code review, writing to a client, handling an incident, working with a team. An AI turns the author's description into the whole lesson.

Continue the author's description where it stops, with the next few words or one short sentence (at most 25 words). Build on their idea; never change its direction, topic or skill, and never contradict it. Add what makes it concrete and easy to turn into a lesson, whichever is still missing: who the learner is, the concrete steps they should practise, what a good result looks like, who coaches them, what arrives in the inbox or chat.

Stay on the author's topic. Don't bring in outages, deadlines, angry clients or a bug to fix unless the author already did.

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
  if (!/(junior|new hire|intern|beginner|graduate|learner|developer|engineer)/.test(t)) return join(text, ended ? 'It is for a junior developer in their first week.' : ' for a junior developer in their first week')
  const nudge = !/(mentor|senior|lead|coach)/.test(t) ? 'A senior engineer coaches them over chat.'
    : !/(step|then|first|finally)/.test(t) ? 'First they look around, then they make one small change.'
    : 'They finish by telling the team what they did.'
  return join(text, ended ? nudge : '. ' + nudge)
}

/** The model's continuation, or null when it gave none: busy, down, or nothing usable. Swapped out by the checks. */
export const model = {
  complete: async (text: string, base?: Scenario): Promise<string | null> => {
    if (mode() === 'stub') return stub(text)
    const about = base ? `They are asking for a change to their lesson "${base.title}": ${base.summary ?? ''}\n\n` : ''
    // Reasoning tokens count against the budget too, so a tight one ends before the answer and comes back empty.
    const calls = await ask({ system: SYSTEM, user: `${about}The author's text so far:\n${text}`, tools: [SUGGEST], priority: 2, timeoutMs: 8_000, maxTokens: 400, optional: true })
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

/** A suggestion to append to the text, or '' when there is none worth showing. `retry` says there may be one if asked again in a
 * moment: the model was busy or gave nothing usable, which is no verdict on the text. */
export async function complete(userId: string, raw: { text?: unknown; lessonId?: unknown }): Promise<{ suggestion: string; retry?: true }> {
  await author(userId)
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_PROMPT) : ''
  if (text.trim().length < MIN_TEXT) return { suggestion: '' }
  const id = typeof raw.lessonId === 'string' ? raw.lessonId : null
  if (id) await owned(userId, id)
  allow(userId)
  const base = id ? (await latest(id))?.spec as Scenario | undefined : undefined
  const answer = await model.complete(text, base)
  if (answer === null) return { suggestion: '', retry: true }
  const s = join(text, answer)
  return { suggestion: text.length + s.length > MAX_PROMPT ? '' : s }
}

// ---------- routes: /api/my/lessons/complete ----------
export const completeApi = Router()
completeApi.post('/complete', async (req, res) => { res.json(await complete(who(res), req.body ?? {})) })
