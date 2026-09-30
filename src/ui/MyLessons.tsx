// Writing lessons: the author's list with a box to describe a new one, and an editor for each draft. The AI writes and revises the
// draft; the author tests it by playing it through, then publishes it. Power users can edit the JSON directly.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Braces, Check, LoaderCircle, Play, Send, Sparkles } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import type { GuideStep } from '../../shared/guide.ts'
import type { Scenario } from '../../shared/scenario.ts'
import { useAccount, useWho } from '../sim/auth.ts'
import { sim } from '../sim/store.ts'
import { SignIn } from './SignIn.tsx'
import { SuggestingTextarea } from './Suggest.tsx'
import { Top } from './Library.tsx'
import { rise, stagger } from './bits.tsx'

const Code = lazy(() => import('./apps/Monaco.tsx').then(m => ({ default: m.Code })))

const VISIBILITIES = [['public', 'Public: listed in the library'], ['unlisted', 'Unlisted: anyone with the link'], ['private', 'Private: only you']] as const
type Visibility = typeof VISIBILITIES[number][0]
interface Mine {
  id: string; title: string; summary: string | null; tags: string[]; visibility: Visibility; updatedAt: string
  version: number; status: 'draft' | 'published'; tested: boolean; published: boolean
  /** Taken down by moderators: nobody can play it, the author included, until they restore it. */
  removed: { reason: string } | null
}
interface Full extends Mine { spec: Scenario; prompt: string | null }
interface Quota { remaining: number; limit: number; resetsAt: string }
/** How far a generation has got, as the server streams it (server/generate.ts). */
interface Progress {
  phase: 'queued' | 'writing' | 'checking' | 'repairing' | 'saving'; kind: 'practice' | 'incident'; chars: number; usual: number; problems?: number
  peek: { title?: string; goal?: string; people: string[]; emails: string[]; steps: string[] }
}

class Failed extends Error { data: { generations?: Quota } = {} }
async function send<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body) }
  let res: Response
  try {
    res = await fetch(url, init)
  } catch { throw new Failed('Cannot reach the LARP server.') }
  const data = await res.json().catch(() => ({}))
  if (res.ok) return data as T
  throw Object.assign(new Failed(data.error ?? `The server answered ${res.status}.`), { data })
}
const API = '/api/my/lessons'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="screen">
      <Top />
      <div className="page"><motion.main className="library authoring" variants={stagger(0.06, 0.04)} initial="hidden" animate="show">{children}</motion.main></div>
    </div>
  )
}

/** Only a confirmed account writes lessons. Everyone else is told how to get one. */
function Gate({ children }: { children: () => ReactNode }) {
  const { config, userId, loading } = useWho()
  const account = useAccount()
  if (loading) return null
  if (!config.enabled) return <Note title="Writing lessons needs accounts.">This server runs without them.</Note>
  if (!userId) return <div className="screen"><SignIn config={config} start="register" onDone={() => {}} /></div>
  if (account?.isAnonymous) {
    return <Note title="Sign up to create lessons.">You're playing as a guest. Make an account and confirm your email, and you can write your own lessons.{account.save && <div><button className="btn btn-ink" onClick={account.save}>Sign up</button></div>}</Note>
  }
  if (!account?.verified) return <Note title="Confirm your email to create lessons.">We sent a link when you signed up. Open it, then come back here.</Note>
  return <Shell>{children()}</Shell>
}
function Note({ title, children }: { title: string; children: ReactNode }) {
  return <Shell><motion.section variants={rise} className="library-head"><h1>{title}</h1><div className="lede gate">{children}</div><Link className="link lesson-back" to="/"><ArrowLeft size={14} /> Library</Link></motion.section></Shell>
}

function Left({ quota }: { quota: Quota | null }) {
  if (!quota) return null
  if (quota.remaining > 0) return <span className="sub">{quota.remaining} of {quota.limit} AI generations left today</span>
  return <span className="quota-out">No AI generations left today. More at {new Date(quota.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</span>
}
/** Asks for a lesson and hears it being written: each progress line goes to `tell`, and it resolves to the lesson. */
async function generate(body: { prompt: string; lessonId?: string }, tell: (p: Progress) => void): Promise<{ lesson: Full; generations: Quota }> {
  let res: Response
  try {
    res = await fetch(`${API}/generate`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(body) })
  } catch { throw new Failed('Cannot reach the LARP server.') }
  // Refused before the stream starts (not signed in, say): one JSON answer.
  if (!res.headers.get('content-type')?.includes('ndjson') || !res.body) {
    const data = await res.json().catch(() => ({}))
    if (res.ok) return data
    throw Object.assign(new Failed(data.error ?? `The server answered ${res.status}.`), { data })
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += value ?? ''
    const lines = buffer.split('\n')
    buffer = done ? '' : lines.pop()!
    for (const line of lines.filter(Boolean)) {
      const d = JSON.parse(line)
      if (d.progress) tell(d.progress)
      else if (d.lesson) return d
      else if (d.error) throw Object.assign(new Failed(d.error), { data: d })
    }
    if (done) throw new Failed('The connection closed before the lesson was ready. If it finished, it is in My lessons.')
  }
}

const PHASES = [['queued', 'Reading your description'], ['writing', 'Writing the lesson'], ['checking', 'Checking it works in the simulator'], ['repairing', 'Fixing what didn’t fit'], ['saving', 'Saving your draft']] as const
/** The generation as it happens: what stage it is at, how much is written, and what the lesson says so far. */
function Writing({ p, since }: { p: Progress | null; since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const phase = p?.phase ?? 'queued', thinking = phase === 'queued' || ((phase === 'writing' || phase === 'repairing') && !p?.chars)
  const share = p ? Math.min(1, p.chars / p.usual) : 0
  const pct = { queued: 3, writing: 6 + 78 * share, checking: 86, repairing: 86 + 8 * share, saving: 97 }[phase]
  const at = PHASES.findIndex(([k]) => k === phase)
  const shown = PHASES.filter(([k]) => k !== 'repairing' || phase === 'repairing' || (p?.problems && at > 3))
  const headline = thinking ? 'The AI is planning your lesson' : { queued: '', writing: 'Writing your lesson', checking: 'Checking the lesson', repairing: 'Fixing a few things', saving: 'Saving your draft' }[phase]
  const secs = Math.max(0, Math.round((now - since) / 1000))
  const peek = p?.peek
  return (
    <div className="gen-live" role="status" aria-live="polite">
      <div className="gen-head"><Sparkles size={15} className="gen-spark" /><b>{headline}…</b><span className="grow" /><span className="sub tnum">{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`}</span></div>
      <div className="track tall"><i className="gen-bar" style={{ width: pct + '%' }} /></div>
      <ol className="gen-phases">
        {shown.map(([k, label]) => {
          const i = PHASES.findIndex(([x]) => x === k), state = i < at ? 'done' : i === at ? 'now' : ''
          return (
            <li key={k} className={state}>
              <span className="gen-mark">{state === 'done' ? <Check size={11} strokeWidth={3} /> : state === 'now' ? <LoaderCircle size={12} className="spin" /> : null}</span>
              <span>{label}{k === 'writing' && p && p.chars > 0 && phase === 'writing' ? <span className="sub"> · {p.chars.toLocaleString()} characters</span> : null}{k === 'repairing' && p?.problems ? <span className="sub"> · {p.problems} problem{p.problems === 1 ? '' : 's'} found, second try</span> : null}</span>
            </li>
          )
        })}
      </ol>
      {peek && (peek.title || peek.people.length > 0) && (
        <div className="gen-peek">
          {peek.title && <div className="gen-row"><span className="field-label">Title</span><b>{peek.title}</b></div>}
          {peek.goal && <div className="gen-row"><span className="field-label">Goal</span><span>{peek.goal}</span></div>}
          {peek.people.length > 0 && <div className="gen-row"><span className="field-label">People</span><span className="tag-row">{peek.people.map(n => <span key={n} className="chip">{n}</span>)}</span></div>}
          {peek.steps.length > 0 && (
            <div className="gen-row"><span className="field-label">Steps</span>
              <ol className="gen-steps"><AnimatePresence initial={false}>{peek.steps.map((t, i) => <motion.li key={i + t} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>{t}</motion.li>)}</AnimatePresence></ol>
            </div>
          )}
        </div>
      )}
      <div className="sub small">{p?.kind === 'incident' ? 'An incident shift is long: this usually takes about a minute.' : 'This usually takes 15 to 40 seconds.'} You can leave this page: the draft appears in My lessons when it’s done.</div>
    </div>
  )
}

/** The prompt box, for a new lesson or a revision. */
function Ask({ lessonId, placeholder, label, onDone }: { lessonId?: string; placeholder: string; label: string; onDone: (l: Full) => void }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<Quota | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [since, setSince] = useState(0)
  useEffect(() => { send<Quota>(`${API}/generate`).then(setQuota, () => {}) }, [])
  const suggest = async (text: string, signal: AbortSignal) => {
    const res = await fetch(`${API}/complete`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lessonId }) })
    if (!res.ok) return ''
    const { suggestion, retry } = await res.json() as { suggestion?: string; retry?: boolean }
    return retry ? null : suggestion ?? ''
  }
  const go = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setProgress(null)
    setSince(Date.now())
    try {
      const { lesson, generations } = await generate({ prompt, lessonId }, setProgress)
      setQuota(generations)
      setPrompt('')
      onDone(lesson)
    } catch (err) {
      setError((err as Error).message)
      if (err instanceof Failed && err.data.generations) setQuota(err.data.generations)
    }
    setBusy(false)
  }
  return (
    <form className="ask" onSubmit={go}>
      <SuggestingTextarea rows={lessonId ? 3 : 4} maxLength={2000} placeholder={placeholder} aria-label={label} value={prompt} onChange={setPrompt} disabled={busy} suggest={suggest} />
      <div className="ask-foot">
        <Left quota={quota} />
        <button className="btn btn-ink" disabled={busy || !prompt.trim() || quota?.remaining === 0}><Sparkles size={14} />{busy ? 'Writing…' : label}</button>
      </div>
      {busy && <Writing p={progress} since={since} />}
      {error && <pre className="gen-error" role="alert">{error}</pre>}
    </form>
  )
}

const Removed = ({ l }: { l: Mine }) => l.removed && <div className="removed" role="note">Removed by moderators{l.removed.reason ? `: ${l.removed.reason}` : '.'}</div>

function Status({ l }: { l: Mine }) {
  if (l.removed) return <span className="tag-row"><span className="chip bad">Removed</span></span>
  return (
    <span className="tag-row">
      {l.status === 'published' ? <span className="chip on-live">Published · {l.visibility}</span>
        : <><span className="chip">Draft v{l.version}</span>{l.tested ? <span className="chip on-ok">Tested</span> : <span className="chip">Not tested</span>}</>}
      {l.status === 'draft' && l.published && <span className="chip on-live">Earlier version live · {l.visibility}</span>}
    </span>
  )
}

export function MyLessons() {
  return <Gate>{() => <List />}</Gate>
}
function List() {
  const [lessons, setLessons] = useState<Mine[] | null>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => { send<Mine[]>(API).then(setLessons, e => setError(e.message)) }, [])
  return (
    <>
      <motion.section variants={rise} className="library-head">
        <div className="eyebrow">MY LESSONS</div>
        <h1>Write a lesson for others to practise.</h1>
        <p className="lede">Describe the skill and who it's for, and the AI drafts the lesson: the task and its steps, the mentor, and what lands in the inbox. Play it through yourself, then publish it.</p>
      </motion.section>
      <motion.section variants={rise} className="author-card">
        <div className="field-label">New lesson</div>
        <Ask label="Generate" placeholder="Git basics for a new developer: make a branch, commit a small change and push it, with a senior engineer coaching…" onDone={l => navigate(`/my/lessons/${encodeURIComponent(l.id)}`)} />
        <div className="sub small">Lessons run on a built-in codebase, an invoicing API, with git, a terminal, email, chat, tickets and a wiki. Teach any skill that fits: git, reading code, testing, code review, writing to a client, handling an incident.</div>
      </motion.section>
      {error ? <div className="cta-note bad" role="alert">{error}</div> : lessons && (lessons.length === 0
        ? <div className="library-empty sub">No lessons yet. Describe one above.</div>
        : <div className="lesson-grid">
            {lessons.map(l => (
              <Link key={l.id} to={`/my/lessons/${encodeURIComponent(l.id)}`} className="lesson-card">
                <b className="lesson-title">{l.title}</b>
                {l.summary && <span className="lesson-summary">{l.summary}</span>}
                <Removed l={l} />
                <span className="lesson-foot"><Status l={l} /></span>
              </Link>
            ))}
          </div>)}
    </>
  )
}

export function LessonEditor() {
  return <Gate>{() => <Editor />}</Gate>
}
function Editor() {
  const { id = '' } = useParams()
  const [lesson, setLesson] = useState<Full | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [json, setJson] = useState<string | null>(null)
  const [vis, setVis] = useState<Visibility>('public')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  useEffect(() => { send<Full>(`${API}/${encodeURIComponent(id)}`).then(setLesson, () => setLesson(null)) }, [id])

  const act = async (work: () => Promise<Full>) => {
    setBusy(true)
    setError('')
    try { setLesson(await work()); return true } catch (e) { setError((e as Error).message); return false } finally { setBusy(false) }
  }
  const path = `${API}/${encodeURIComponent(id)}`
  const publish = () => act(() => send<Full>(`${path}/publish`, 'POST', { visibility: vis }))
  const reshow = (to: Visibility) => act(() => send<Full>(path, 'PATCH', { visibility: to }))
  const save = async () => {
    let spec: unknown
    try { spec = JSON.parse(json ?? '') } catch (e) { return setError(`That isn't valid JSON: ${(e as Error).message}`) }
    if (await act(() => send<Full>(path, 'PUT', { spec }))) setJson(null)
  }
  const test = () => { sim.choose(id); navigate('/play') }

  if (lesson === null) return <motion.section variants={rise} className="library-head"><h1>That lesson isn't yours, or isn't here.</h1><Link className="link lesson-back" to="/my/lessons"><ArrowLeft size={14} /> My lessons</Link></motion.section>
  if (!lesson) return null
  const s = lesson.spec
  return (
    <>
      <motion.section variants={rise} className="library-head">
        <Link className="link lesson-back" to="/my/lessons"><ArrowLeft size={14} /> My lessons</Link>
        <h1>{lesson.title}</h1>
        {lesson.summary && <p className="lede">{lesson.summary}</p>}
        <div className="tag-row"><Status l={lesson} />{lesson.tags.map(t => <span key={t} className="chip tag">{t}</span>)}</div>
        <Removed l={lesson} />
      </motion.section>

      <motion.section variants={rise} className="author-card">
        <div className="field-label">Test, then publish</div>
        <div className="author-actions">
          <button className="btn btn-ink" disabled={!!lesson.removed} onClick={test}><Play size={14} />Test it</button>
          {lesson.status === 'published' ? (
            <label className="author-vis">Who can play it
              <select className="select" value={lesson.visibility} disabled={busy || !!lesson.removed} onChange={e => void reshow(e.target.value as Visibility)}>
                {VISIBILITIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
          ) : (
            <span className="author-vis">
              <select className="select" aria-label="Who can play it" value={vis} onChange={e => setVis(e.target.value as Visibility)}>
                {VISIBILITIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              <button className="btn btn-accent" disabled={busy || !lesson.tested || !!lesson.removed} onClick={() => void publish()}><Send size={14} />Publish</button>
            </span>
          )}
        </div>
        <div className="sub small">
          {lesson.removed ? 'Moderators took this lesson down, so it can’t be played or published. You can still revise it.'
            : lesson.status === 'published' ? `Version ${lesson.version} is live. Revising or editing it makes a new draft; players keep this version until you publish that.`
            : lesson.tested ? `You finished version ${lesson.version}. It's ready to publish.`
            : `Publishing opens once you've tested version ${lesson.version}: play it through, finish every step, then press Finish lesson.`}
        </div>
      </motion.section>

      <motion.section variants={rise} className="author-card">
        <div className="field-label">Revise with AI</div>
        {lesson.prompt && <div className="sub small">Last asked: “{lesson.prompt}”</div>}
        <Ask lessonId={lesson.id} label="Revise" placeholder="Add a step where they undo a mistake with git restore, and make the mentor more hands-off…" onDone={setLesson} />
      </motion.section>

      {error && <pre className="gen-error" role="alert">{error}</pre>}

      <motion.section variants={rise} className="author-card">
        <div className="author-row">
          <div className="field-label">{json === null ? 'What happens' : 'Edit JSON'}</div>
          {json === null
            ? <button className="btn sm btn-chip" onClick={() => setJson(JSON.stringify(s, null, 2))}><Braces size={13} />Edit JSON</button>
            : <span className="author-vis"><button className="btn sm btn-chip" onClick={() => { setJson(null); setError('') }}>Cancel</button><button className="btn sm btn-ink" disabled={busy} onClick={() => void save()}>Save draft</button></span>}
        </div>
        {json !== null
          ? <div className="json-edit"><Suspense fallback={<div className="sub">Loading the editor…</div>}><Code path={`lesson-${id}.json`} value={json} onChange={setJson} onSave={() => void save()} /></Suspense></div>
          : <Outline s={s} />}
      </motion.section>
    </>
  )
}

const EVENT = { start: 'Start', 'incident.opened': 'Incident', 'incident.resolved': 'Resolved' } as const
const cut = (t: string, n = 140) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
function Outline({ s }: { s: Scenario }) {
  const name = (id: string) => s.cast[id]?.name ?? id
  // Whoever plays is cast by name when the shift starts; here the player's card stands in.
  const say = (t: string) => cut(t.replaceAll('{{player}}', name(s.player).split(' ')[0]))
  // A version saved before phases were data has only guide, its opening steps.
  const first = (s.phases?.[0]?.steps ?? (s as { guide?: GuideStep[] }).guide ?? []).filter(g => !g.if && !g.each)
  // The database keeps a spec's keys in its own order, so the player and mentor go first by hand.
  const cast = Object.entries(s.cast).filter(([id, c]) => id === s.player || c.persona)
    .sort(([a], [b]) => Number(b === s.player) - Number(a === s.player) || Number(b === s.mentor) - Number(a === s.mentor))
  const role = (id: string) => (id === s.player ? 'You' : id === s.mentor ? 'Mentor' : s.cast[id].persona ? 'Replies' : '')
  const beats = [...s.triggers].sort((a, b) => Object.keys(EVENT).indexOf(a.when.on) - Object.keys(EVENT).indexOf(b.when.on) || a.when.after - b.when.after)
  return (
    <div className="outline">
      <div className="field">
        <div className="sub small">{s.company.name}, {s.company.description} · {s.clock.start}{s.clock.deadline ? ` to ${s.clock.deadline}` : ''}</div>
      </div>
      <div className="field">
        <div className="field-label">The goal</div>
        {s.goal ? <div><b>{s.goal.title}</b><div className="sub">{s.goal.summary}</div></div>
          : <div className="sub">Fix LED-214, the SSO bug in the code, and ship it to production without breaking anything else.</div>}
      </div>
      <div className="field">
        <div className="field-label">Cast</div>
        <ul className="outline-list cast-list">
          {cast.map(([id, c]) => (
            <li key={id}><span className="dot" style={{ background: c.color }} /><b>{c.name}</b><span className="sub">{c.title}</span>{role(id) && <span className="chip">{role(id)}</span>}</li>
          ))}
        </ul>
      </div>
      <div className="field">
        <div className="field-label">In the inbox at the start</div>
        <ul className="outline-list">{s.seed.emails.filter(e => e.folder === 'inbox').map(e => <li key={e.id}><b>{name(e.who)}</b><span>{e.subject}</span></li>)}</ul>
      </div>
      {beats.length > 0 && (
        <div className="field">
          <div className="field-label">What happens, and when</div>
          <ul className="outline-list beats">
            {beats.flatMap(t => t.do.filter(a => a.post || a.mail).map((a, i) => (
              <li key={t.id + i}>
                <span className="chip">{EVENT[t.when.on]} +{t.when.after}m</span>
                {a.post ? <span><b>{name(a.post.who)}</b> {s.channels[a.post.chan]?.dm ? 'messages you' : `in ${s.channels[a.post.chan]?.label ?? a.post.chan}`}: {say(a.post.text)}</span>
                  : <span><b>{name(a.mail!.who)}</b> emails: {say(a.mail!.subject)}</span>}
              </li>
            )))}
          </ul>
        </div>
      )}
      {first.length > 0 && (
        <div className="field">
          <div className="field-label">{s.goal ? 'The steps' : "The player's first steps"}</div>
          <ol className="outline-steps">{first.map(g => <li key={g.id}>{say(g.text)}</li>)}</ol>
        </div>
      )}
    </div>
  )
}
