// The lesson library: every public lesson, readable without signing in, and a page for each with a Start button.
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Flag, Play, Search, ShieldCheck } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { LEVELS } from '../../shared/types.ts'
import type { World } from '../../shared/types.ts'
import { useAccount, useWho } from '../sim/auth.ts'
import { sim } from '../sim/store.ts'
import { Brand, ThemeToggle, rise, stagger } from './bits.tsx'

interface Lesson { id: string; title: string; summary: string | null; tags: string[]; author: { name: string } | null; updatedAt: string }
interface Tag { tag: string; count: number }
type Roster = Pick<World, 'company' | 'cast' | 'player' | 'mentor' | 'levels'>

export const get = <T,>(url: string, signal?: AbortSignal): Promise<T> =>
  fetch(url, { signal }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T> })
/** A POST whose failure carries the server's own message. */
export const post = <T,>(url: string, body: unknown = {}): Promise<T> =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => {
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(json.error ?? `The server answered ${r.status}.`)
    return json as T
  }, () => { throw new Error('Cannot reach the LARP server.') })
const byline = (l: Lesson) => (l.author ? `By ${l.author.name}` : 'LARP original')

export function Top() {
  const account = useAccount()
  return (
    <header className="topbar">
      <Brand home />
      <div className="topbar-right">
        {account?.isAnonymous && account.save && <button className="btn sm btn-soft" onClick={account.save}><span>Save<span className="wide"> your progress</span></span></button>}
        {account?.role === 'admin' && <Link className="btn sm btn-chip" to="/admin" aria-label="Moderation"><ShieldCheck size={14} /><span className="wide">Moderation</span></Link>}
        <ThemeToggle />
        {account && <><span>{account.name}</span><button className="btn sm btn-chip" onClick={() => void account.signOut()}>Sign out</button></>}
      </div>
    </header>
  )
}

/** An unfinished shift to go back to: this tab's, or with an account the newest one still going. */
function useUnfinished() {
  const { config, userId } = useWho()
  const [run, setRun] = useState<{ id: string; title?: string } | null>(null)
  useEffect(() => {
    const here = sim.saved()
    // Without accounts the server keeps no list, so this tab's shift is the one.
    if (!config.enabled) return setRun(here ? { id: here } : null)
    if (!userId) return setRun(null)
    const ask = new AbortController()
    get<{ id: string; title: string; status: string }[]>('/api/me/runs', ask.signal).then(runs => {
      const active = runs.filter(r => r.status === 'active')
      setRun(active.find(r => r.id === here) ?? active[0] ?? null)
    }, () => {})
    return () => ask.abort()
  }, [config.enabled, userId])
  return run
}

export function Library() {
  const [params, setParams] = useSearchParams()
  const tag = params.get('tag') ?? '', q = params.get('q') ?? ''
  const [tags, setTags] = useState<Tag[]>([])
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [error, setError] = useState('')
  const run = useUnfinished()
  const navigate = useNavigate()

  useEffect(() => { get<Tag[]>('/api/lessons/tags').then(setTags, () => {}) }, [])
  useEffect(() => {
    const ask = new AbortController()
    // Typing waits a moment so each keystroke isn't a request.
    const t = setTimeout(() => {
      get<Lesson[]>(`/api/lessons?${new URLSearchParams({ tag, q: q.trim() })}`, ask.signal)
        .then(l => { setLessons(l); setError('') }, e => { if (!ask.signal.aborted) setError(e.message === 'Failed to fetch' ? 'Cannot reach the LARP server.' : 'The library did not load. Try again.') })
    }, q ? 200 : 0)
    return () => { clearTimeout(t); ask.abort() }
  }, [tag, q])
  const filter = (next: { tag?: string; q?: string }) => {
    const p = new URLSearchParams({ tag, q, ...next })
    for (const k of ['tag', 'q']) if (!p.get(k)) p.delete(k)
    setParams(p, { replace: true })
  }
  const resume = (id: string) => { sim.pickUp(id); navigate('/play') }

  return (
    <div className="screen">
      <Top />
      <div className="page">
        <motion.main className="library" variants={stagger(0.06, 0.04)} initial="hidden" animate="show">
          <motion.section variants={rise} className="library-head">
            <div className="eyebrow">LESSON LIBRARY</div>
            <h1>Pick a shift to practise.</h1>
            <p className="lede">Each lesson is a day at work: a real codebase, colleagues who message you, and a mentor who steps in when it goes wrong.</p>
          </motion.section>
          {run && (
            <motion.button variants={rise} className="lesson-card resume" onClick={() => resume(run.id)}>
              <Play size={18} strokeWidth={2.2} />
              <span className="grow"><b>Resume your shift</b>{run.title && <span className="sub"> · {run.title}</span>}</span>
              <ArrowRight size={16} strokeWidth={2.4} />
            </motion.button>
          )}
          <motion.div variants={rise} className="library-filters">
            <label className="library-search">
              <Search size={15} />
              <input className="input" type="search" placeholder="Search lessons" aria-label="Search lessons" maxLength={100} value={q} onChange={e => filter({ q: e.target.value })} />
            </label>
            {tags.length > 0 && (
              <div className="tag-row" role="group" aria-label="Filter by tag">
                <button className={'chip tag' + (tag ? '' : ' on')} aria-pressed={!tag} onClick={() => filter({ tag: '' })}>All</button>
                {tags.map(t => <button key={t.tag} className={'chip tag' + (t.tag === tag ? ' on' : '')} aria-pressed={t.tag === tag} onClick={() => filter({ tag: t.tag === tag ? '' : t.tag })}>{t.tag}<span className="tag-n">{t.count}</span></button>)}
              </div>
            )}
          </motion.div>
          {error ? <div className="cta-note bad" role="alert">{error}</div>
            : lessons && (lessons.length === 0
              ? <div className="library-empty sub">No lessons match{q ? ` "${q.trim()}"` : ''}{tag ? ` in ${tag}` : ''}.</div>
              : <div className="lesson-grid">
                  {lessons.map(l => (
                    <Link key={l.id} to={`/lessons/${encodeURIComponent(l.id)}`} className="lesson-card">
                      <b className="lesson-title">{l.title}</b>
                      {l.summary && <span className="lesson-summary">{l.summary}</span>}
                      <span className="lesson-foot">
                        <span className="sub">{byline(l)}</span>
                        {l.tags.map(t => <span key={t} className="chip tag">{t}</span>)}
                      </span>
                    </Link>
                  ))}
                </div>)}
        </motion.main>
      </div>
    </div>
  )
}

export function LessonPage() {
  const { id = '' } = useParams()
  const [lesson, setLesson] = useState<Lesson | null | undefined>(undefined)
  const [roster, setRoster] = useState<Roster | null>(null)
  const { config, userId } = useWho()
  const navigate = useNavigate()

  useEffect(() => {
    const ask = new AbortController()
    setLesson(undefined)
    setRoster(null)
    // The library has no single-lesson endpoint yet, so the lesson comes from the list.
    get<Lesson[]>('/api/lessons', ask.signal).then(all => setLesson(all.find(l => l.id === id) ?? null), () => { if (!ask.signal.aborted) setLesson(null) })
    get<Roster>(`/api/scenario?id=${encodeURIComponent(id)}`, ask.signal).then(setRoster, () => {})
    return () => ask.abort()
  }, [id])

  const start = () => { sim.choose(id); navigate('/play') }
  const me = roster?.cast[roster.player], mentor = roster?.cast[roster.mentor]

  return (
    <div className="screen">
      <Top />
      <div className="page">
        {lesson === null ? (
          <main className="library">
            <div className="library-head">
              <h1>That lesson isn't here.</h1>
              <p className="lede">It may have been taken down, or the link is wrong.</p>
            </div>
            <Link className="link" to="/"><ArrowLeft size={14} /> Back to the library</Link>
          </main>
        ) : lesson && (
          <motion.main className="onboard" variants={stagger(0.07, 0.05)} initial="hidden" animate="show">
            <section className="hero">
              <motion.div variants={rise}><Link className="link lesson-back" to="/"><ArrowLeft size={14} /> Library</Link></motion.div>
              <motion.div variants={rise} className="eyebrow">{byline(lesson).toUpperCase()}</motion.div>
              <motion.h1 variants={rise}>{lesson.title}</motion.h1>
              {lesson.summary && <motion.p variants={rise} className="lede">{lesson.summary}</motion.p>}
              {lesson.tags.length > 0 && <motion.div variants={rise} className="tag-row">{lesson.tags.map(t => <Link key={t} className="chip tag" to={`/?tag=${encodeURIComponent(t)}`}>{t}</Link>)}</motion.div>}
            </section>
            <motion.section variants={rise} className="card setup">
              {roster && (
                <div className="field">
                  <div className="field-label">The job</div>
                  <dl className="lesson-facts">
                    <dt>Company</dt><dd>{roster.company}</dd>
                    {me && <><dt>You play</dt><dd>{me.title}</dd></>}
                    {mentor && <><dt>Your mentor</dt><dd>{mentor.name}, {mentor.title}</dd></>}
                  </dl>
                </div>
              )}
              {roster && (
                <div className="field">
                  <div className="field-label">Starting points</div>
                  <div className="lesson-levels">
                    {LEVELS.filter(k => roster.levels[k]).map(k => <div key={k} className="tile"><b>{roster.levels[k]!.label}</b><span>{roster.levels[k]!.blurb}</span></div>)}
                  </div>
                  <div className="level-note">You choose one on the next page.</div>
                </div>
              )}
              <button className="cta" onClick={start}>Start <ArrowRight size={17} strokeWidth={2.4} /></button>
              <div className="cta-note">{config.enabled && !userId ? 'Sign in or continue as a guest to start' : 'About 25 minutes · No score at the end'}</div>
              {config.enabled && userId && <Report id={id} />}
            </motion.section>
          </motion.main>
        )}
      </div>
    </div>
  )
}

const REASONS = [['broken', "It's broken"], ['offensive', 'Offensive or harmful'], ['spam', 'Spam or advertising'], ['other', 'Something else']] as const

/** Tells the moderators about a lesson. Built-ins too: they can break like any other. */
function Report({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<typeof REASONS[number][0]>('broken')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { setOpen(false); setResult(null); setNote('') }, [id])

  const send = () => {
    setBusy(true)
    post(`/api/lessons/${encodeURIComponent(id)}/report`, { reason, note: note.trim() || undefined })
      .then(() => { setResult({ ok: true, text: 'Thanks. The moderators will take a look.' }); setOpen(false) }, (e: Error) => setResult({ ok: false, text: e.message }))
      .finally(() => setBusy(false))
  }
  if (result?.ok) return <div className="report-done sub" role="status">{result.text}</div>
  if (!open) return <button className="link report-open" onClick={() => setOpen(true)}><Flag size={12} /> Report this lesson</button>
  return (
    <div className="report">
      <div className="field-label">What's wrong with it?</div>
      <select className="select" aria-label="Reason" value={reason} onChange={e => setReason(e.target.value as typeof reason)}>
        {REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <textarea className="input" rows={3} maxLength={500} placeholder="Anything the moderators should know (optional)" aria-label="Note" value={note} onChange={e => setNote(e.target.value)} />
      {result && <div className="cta-note bad" role="alert">{result.text}</div>}
      <div className="report-actions">
        <button className="btn sm btn-chip" onClick={() => { setOpen(false); setResult(null) }}>Cancel</button>
        <button className="btn sm btn-ink" disabled={busy} onClick={send}>{busy ? 'Sending...' : 'Send report'}</button>
      </div>
    </div>
  )
}
