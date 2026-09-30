// Writing lessons: the author's list with a box to describe a new one, and an editor for each draft. The AI writes and revises the
// draft; the author tests it by playing it through, then publishes it. Power users can edit the JSON directly.
import { Suspense, lazy, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Braces, Play, Send, Sparkles } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
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
    return <Note title="Sign up to create lessons.">You're playing as a guest. Make an account and confirm your email, and you can write your own shifts.{account.save && <div><button className="btn btn-ink" onClick={account.save}>Sign up</button></div>}</Note>
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
/** The prompt box, for a new lesson or a revision. */
function Ask({ lessonId, placeholder, label, onDone }: { lessonId?: string; placeholder: string; label: string; onDone: (l: Full) => void }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<Quota | null>(null)
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
    try {
      const { lesson, generations } = await send<{ lesson: Full; generations: Quota }>(`${API}/generate`, 'POST', { prompt, lessonId })
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
      {busy && <div className="sub" role="status">The AI is writing the whole lesson. This can take a minute or two.</div>}
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
        <h1>Write a shift for others to practise.</h1>
        <p className="lede">Describe the day and the AI drafts it: the company, the people, what lands in the inbox and when. Play it through yourself, then publish it.</p>
      </motion.section>
      <motion.section variants={rise} className="author-card">
        <div className="field-label">New lesson</div>
        <Ask label="Generate" placeholder="A fintech startup on the Friday before a release. The PM keeps changing priorities and a big client emails about a login bug…" onDone={l => navigate(`/my/lessons/${encodeURIComponent(l.id)}`)} />
        <div className="sub small">For now every lesson runs on the same built-in codebase, an auth service, so the bug to fix stays the same. Everything around it is yours.</div>
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
            : lesson.tested ? `You finished a shift on version ${lesson.version}. It's ready to publish.`
            : `Publishing opens once you've tested version ${lesson.version}: play it, ship the fix so every check passes, then end the shift.`}
        </div>
      </motion.section>

      <motion.section variants={rise} className="author-card">
        <div className="field-label">Revise with AI</div>
        {lesson.prompt && <div className="sub small">Last asked: “{lesson.prompt}”</div>}
        <Ask lessonId={lesson.id} label="Revise" placeholder="Make the manager more impatient, and have the client email arrive earlier…" onDone={setLesson} />
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
      {s.guide.length > 0 && (
        <div className="field">
          <div className="field-label">The player's first steps</div>
          <ol className="outline-steps">{s.guide.map(g => <li key={g.id}>{g.text}</li>)}</ol>
        </div>
      )}
    </div>
  )
}
