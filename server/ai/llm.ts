// The one place that talks to the model. Queues, rate-limits, times out, and never throws:
// a caller gets tool calls back, or null and uses its scripted fallback.
// Run this file directly for a smoke test: npm run llm:smoke
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// OpenAI's Responses API. Any model from GET /v1/models works; gpt-6-luna answers in about 2 s for a tenth of a cent.
const BASE = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-6-luna'
const KEY = process.env.OPENAI_API_KEY ?? ''
const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', 'llm-cache.json')
const MAX_IN_FLIGHT = 6, PER_MINUTE = 30

export const mode = (): 'live' | 'stub' => (process.env.LLM !== 'stub' && KEY ? 'live' : 'stub')

// Why the model is not answering, in words the player can act on. null while calls are getting through.
let problem: string | null = process.env.LLM !== 'stub' && !KEY ? 'OPENAI_API_KEY is not set' : null
const watchers = new Set<(p: string | null) => void>()
export const aiProblem = () => problem
export const onAiProblem = (fn: (p: string | null) => void) => watchers.add(fn)
const report = (p: string | null) => {
  if (p !== problem) { problem = p; watchers.forEach(fn => fn(p)) }
  return null
}
export interface Tool { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] } }
export interface Call { name: string; args: Record<string, unknown> }
export interface Ask {
  system: string; user: string; tools: Tool[]
  /** 0 mentor, 1 reply to the player, 2 getting ahead. Lower goes first. */
  priority?: 0 | 1 | 2
  timeoutMs?: number
  /** Output budget. A colleague's line fits in the default; a whole lesson does not. */
  maxTokens?: number
  /** Reuse an earlier answer to the identical question. For prompts that do not depend on the conversation. */
  cache?: boolean
  /** Only worth asking right away, like a typing suggestion: answers null instead of queueing, and leaves half the per-minute budget
   * to the shift. */
  optional?: boolean
}

const cache: Record<string, Call[]> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {}
const inflight = new Map<string, Promise<Call[] | null>>()
const waiting: { priority: number; go: () => void }[] = []
const started: number[] = []
let running = 0
let saving: ReturnType<typeof setTimeout> | undefined

/** Waits for a free slot that also fits under the per-minute limit. */
async function turn(priority: number) {
  if (running >= MAX_IN_FLIGHT) await new Promise<void>(go => { waiting.push({ priority, go }); waiting.sort((a, b) => a.priority - b.priority) })
  running++
  for (;;) {
    const cutoff = Date.now() - 60_000
    while (started.length && started[0] < cutoff) started.shift()
    if (started.length < PER_MINUTE) break
    await new Promise(r => setTimeout(r, started[0] - cutoff + 50))
  }
  started.push(Date.now())
}
const release = () => { running--; waiting.shift()?.go() }
/** Room for an optional call without making anyone wait. */
const spare = () => running < MAX_IN_FLIGHT && started.filter(t => t > Date.now() - 60_000).length < PER_MINUTE / 2

const explain = (status: number) =>
  status === 401 || status === 403 ? `the AI service rejected the API key (HTTP ${status})`
  : status === 404 ? `the AI service does not know the model ${MODEL} (HTTP 404)`
  : status === 429 ? 'the AI service is rate-limiting requests (HTTP 429)' : `the AI service returned HTTP ${status}`

async function request(a: Ask, attempt = 0): Promise<Call[] | null> {
  // Which call a log line is about: a colleague's reply and a whole lesson fail for different reasons.
  const what = a.tools.map(t => t.name).join(',') || 'text'
  let res: Response
  try {
    res = await fetch(BASE + '/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(a.timeoutMs ?? 30_000),
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_output_tokens: a.maxTokens ?? 900, reasoning: { effort: 'low' },
        // Not strict: these schemas leave some properties optional, which strict mode refuses.
        tools: a.tools.map(t => ({ type: 'function', strict: false, ...t })),
        instructions: a.system, input: a.user,
      }),
    })
  } catch (e) {
    const name = (e as Error).name
    console.warn(`[llm] ${what}: no answer:`, name)
    if (attempt < 1 && name !== 'TimeoutError') return request(a, attempt + 1)
    return report(name === 'TimeoutError' ? 'the AI service timed out' : `could not reach the AI service (${name})`)
  }
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, (Number(res.headers.get('retry-after')) || 5) * 1000))
    return request(a, attempt + 1)
  }
  if (!res.ok) {
    // The body says what the service objects to; without it a 400 is a guess.
    console.warn(`[llm] ${what}: http ${res.status}`, (await res.text().catch(() => '')).slice(0, 500))
    if (res.status >= 500 && attempt < 1) return request(a, attempt + 1)
    return report(explain(res.status))
  }
  report(null)
  const body = await res.json().catch(() => null)
  const output: { type: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[] = body?.output ?? []
  const calls: Call[] = []
  for (const item of output) {
    if (item.type !== 'function_call' || !item.name) continue
    try { calls.push({ name: item.name, args: JSON.parse(item.arguments || '{}') }) } catch {
      // Usually an answer cut off at max_output_tokens.
      console.warn(`[llm] ${what}: dropped a malformed ${item.name} call (${item.arguments?.length ?? 0} chars, status ${body?.status})`)
    }
  }
  // The model sometimes just talks. Callers decide whether plain text is usable.
  const text = output.filter(i => i.type === 'message').flatMap(i => i.content ?? []).map(c => c.text ?? '').join('').trim()
  if (!calls.length && text) calls.push({ name: '_text', args: { text } })
  if (!calls.length) console.warn(`[llm] ${what}: answered with nothing usable (status ${body?.status}${body?.incomplete_details ? ', ' + JSON.stringify(body.incomplete_details) : ''})`)
  return calls.length ? calls : null
}

/** Sees every question as it is asked, stub mode included. For the checks. */
export const heard = new Set<(a: Ask) => void>()
export function ask(a: Ask): Promise<Call[] | null> {
  heard.forEach(f => f(a))
  if (mode() === 'stub') return Promise.resolve(null)
  const key = createHash('sha256').update(MODEL + '\0' + a.system + '\0' + a.user + '\0' + a.tools.map(t => t.name).join()).digest('hex')
  if (a.cache && cache[key]) return Promise.resolve(cache[key])
  if (inflight.has(key)) return inflight.get(key)!
  if (a.optional && !spare()) return Promise.resolve(null)
  const job = (async () => {
    await turn(a.priority ?? 1)
    try {
      const calls = await request(a)
      if (calls && a.cache) {
        cache[key] = calls
        clearTimeout(saving)
        saving = setTimeout(() => mkdir(dirname(CACHE_FILE), { recursive: true }).then(() => writeFile(CACHE_FILE, JSON.stringify(cache))).catch(() => {}), 500)
      }
      return calls
    } finally { release(); inflight.delete(key) }
  })()
  inflight.set(key, job)
  return job
}

export interface Stream { system: string; user: string; priority?: 0 | 1 | 2; timeoutMs?: number; maxTokens?: number }
/** How long to wait before each further try when the service is busy or out of reach: three more tries, under a minute in all
 * unless the service asks for longer. */
const RETRY_WAITS = [5_000, 15_000, 30_000]
/** One try at a streamed answer: the text (null when there is none and trying again would not help), or why it is worth another try. */
async function attempt(a: Stream, onText: (text: string) => void): Promise<{ text: string | null } | { busy: string; after: number }> {
  await turn(a.priority ?? 1)
  let text = ''
  try {
    const res = await fetch(BASE + '/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(a.timeoutMs ?? 180_000),
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ model: MODEL, stream: true, max_output_tokens: a.maxTokens ?? 16_000, reasoning: { effort: 'low' }, instructions: a.system, input: a.user }),
    })
    if (!res.ok || !res.body) {
      console.warn('[llm] stream: http', res.status, (await res.text().catch(() => '')).slice(0, 500))
      if (res.status === 429 || res.status >= 500) return { busy: explain(res.status), after: (Number(res.headers.get('retry-after')) || 0) * 1000 }
      return { text: report(explain(res.status)) }
    }
    report(null)
    const decoder = new TextDecoder()
    let buffer = '', status = ''
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const data = buffer.slice(0, end).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('')
        buffer = buffer.slice(end + 2)
        let event: { type?: string; delta?: string; response?: { status?: string; incomplete_details?: unknown } }
        try { event = JSON.parse(data) } catch { continue }
        if (event.type === 'response.output_text.delta' && event.delta) { text += event.delta; onText(text) }
        if (event.response?.status) status = event.response.status
        if (event.type === 'response.incomplete') console.warn('[llm] stream: cut off', JSON.stringify(event.response?.incomplete_details ?? {}), `after ${text.length} chars`)
      }
    }
    if (!text) console.warn(`[llm] stream: answered with nothing usable (status ${status})`)
    return { text: text || null }
  } catch (e) {
    const name = (e as Error).name
    console.warn(`[llm] stream: no answer after ${text.length} chars:`, name)
    // A timeout has already used up the author's patience; anything else is a dropped or refused connection.
    if (name === 'TimeoutError') return { text: report('the AI service timed out') }
    return { busy: `could not reach the AI service (${name})`, after: 0 }
  } finally { release() }
}
/**
 * Asks for plain text and passes it on as it is written: the whole answer so far, each time more arrives. For long answers someone
 * is waiting on, like a whole lesson, so they can watch it being written. Tool calls arrive only once complete, so this uses none.
 * A busy or unreachable service is tried again, and `onRetry` hears which further try is about to wait its turn; the text then
 * starts over. Resolves to the whole text, or null when there is none. Never throws. Not cached.
 */
export function stream(a: Stream, onText: (text: string) => void, onRetry: (attempt: number, of: number) => void = () => {}): Promise<string | null> {
  heard.forEach(f => f({ ...a, tools: [] }))
  if (mode() === 'stub') return Promise.resolve(null)
  return (async () => {
    for (let n = 0; ; n++) {
      const got = await attempt(a, onText)
      if ('text' in got) return got.text
      if (n >= RETRY_WAITS.length) return report(got.busy)
      onRetry(n + 1, RETRY_WAITS.length)
      await new Promise(r => setTimeout(r, Math.min(Math.max(got.after, RETRY_WAITS[n]), 30_000)))
    }
  })()
}

let probing: Promise<string | null> | null = null, probedAt = 0
/** A one-token call that checks the key, URL and model before anyone is waiting on a reply. Resolves to the problem, or null. */
export function probe(): Promise<string | null> {
  if (mode() === 'stub') return Promise.resolve(problem)
  if (probing && Date.now() - probedAt < 60_000) return probing
  probedAt = Date.now()
  return probing = (async () => {
    await turn(0)
    try {
      const res = await fetch(BASE + '/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
        headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_output_tokens: 16, reasoning: { effort: 'low' }, input: 'ping' }),
      })
      if (!res.ok) console.warn('[llm] health check: http', res.status)
      report(res.ok ? null : explain(res.status))
    } catch (e) {
      const name = (e as Error).name
      console.warn('[llm] health check: no answer:', name)
      report(name === 'TimeoutError' ? 'the AI service timed out' : `could not reach the AI service (${name})`)
    } finally { release() }
    return problem
  })()
}

// ---------- guards for whatever the model hands back ----------
export const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '')
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined)
export const list = (v: unknown, max: number, each: number) => (Array.isArray(v) ? v.map(x => str(x, each)).filter(Boolean).slice(0, max) : [])

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`model ${MODEL} · mode ${mode()} · key ${KEY ? 'present' : 'MISSING'}`)
  const t0 = Date.now()
  const calls = await ask({
    system: 'You are a test harness checking that the model answers with a tool call. Act only through the tool.',
    user: 'Post "ok" in the general channel.',
    tools: [{ name: 'send_teams_message', description: 'Post a message in Teams.', parameters: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } }],
  })
  console.log(`answered in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(calls ?? 'no usable answer (the app would use its scripted fallback)')
  process.exit(calls?.[0]?.name === 'send_teams_message' ? 0 : 1)
}
