// The one place that talks to the model. Queues, rate-limits, times out, and never throws:
// a caller gets tool calls back, or null and uses its scripted fallback.
// Run this file directly for a smoke test: npm run llm:smoke
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Perplexity's Agent API. Any model from GET /v1/models works; gpt-6-luna answers in about 2 s for a tenth of a cent.
const BASE = process.env.PERPLEXITY_BASE_URL ?? 'https://api.perplexity.ai/v1'
const MODEL = process.env.PERPLEXITY_MODEL ?? 'openai/gpt-6-luna'
const KEY = process.env.PERPLEXITY_API_KEY ?? process.env.Perplexity_API_Key ?? ''
const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', 'llm-cache.json')
const MAX_IN_FLIGHT = 6, PER_MINUTE = 30

export const mode = (): 'live' | 'stub' => (process.env.LLM !== 'stub' && KEY ? 'live' : 'stub')

// Why the model is not answering, in words the player can act on. null while calls are getting through.
let problem: string | null = process.env.LLM !== 'stub' && !KEY ? 'PERPLEXITY_API_KEY is not set' : null
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
  let res: Response
  try {
    res = await fetch(BASE + '/agent', {
      method: 'POST',
      signal: AbortSignal.timeout(a.timeoutMs ?? 30_000),
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_output_tokens: a.maxTokens ?? 900, reasoning: { effort: 'low' },
        tools: a.tools.map(t => ({ type: 'function', ...t })),
        instructions: a.system, input: a.user,
      }),
    })
  } catch (e) {
    const name = (e as Error).name
    console.warn('[llm] no answer:', name)
    if (attempt < 1 && name !== 'TimeoutError') return request(a, attempt + 1)
    return report(name === 'TimeoutError' ? 'the AI service timed out' : `could not reach the AI service (${name})`)
  }
  if (res.status === 429 && attempt < 2) {
    await new Promise(r => setTimeout(r, (Number(res.headers.get('retry-after')) || 5) * 1000))
    return request(a, attempt + 1)
  }
  if (!res.ok) {
    console.warn('[llm] http', res.status)
    if (res.status >= 500 && attempt < 1) return request(a, attempt + 1)
    return report(explain(res.status))
  }
  report(null)
  const output: { type: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[] =
    (await res.json().catch(() => null))?.output ?? []
  const calls: Call[] = []
  for (const item of output) {
    if (item.type !== 'function_call' || !item.name) continue
    try { calls.push({ name: item.name, args: JSON.parse(item.arguments || '{}') }) } catch { /* a malformed call is dropped */ }
  }
  // The model sometimes just talks. Callers decide whether plain text is usable.
  const text = output.filter(i => i.type === 'message').flatMap(i => i.content ?? []).map(c => c.text ?? '').join('').trim()
  if (!calls.length && text) calls.push({ name: '_text', args: { text } })
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

let probing: Promise<string | null> | null = null, probedAt = 0
/** A one-token call that checks the key, URL and model before anyone is waiting on a reply. Resolves to the problem, or null. */
export function probe(): Promise<string | null> {
  if (mode() === 'stub') return Promise.resolve(problem)
  if (probing && Date.now() - probedAt < 60_000) return probing
  probedAt = Date.now()
  return probing = (async () => {
    await turn(0)
    try {
      const res = await fetch(BASE + '/agent', {
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
