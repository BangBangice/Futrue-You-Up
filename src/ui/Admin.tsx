// Moderation, for admins only: the queue of open reports, and what can be done about each lesson. No content editing here.
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useWho } from '../sim/auth.ts'
import { Top, get, post } from './Library.tsx'

interface Item {
  lesson: { id: string; title: string; hidden: boolean; author: { id: string; name: string; banned: boolean } | null }
  count: number
  reports: { id: string; reason: string; note: string | null; createdAt: string; reporter: string }[]
}
type Action = 'unpublish' | 'dismiss' | 'ban'

// The server decides who is an admin: anyone else gets a 404 from it, and goes back to the library.
export function Admin() {
  const { config, userId } = useWho()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [away, setAway] = useState(false)
  const load = useCallback(() => {
    get<Item[]>('/api/admin/reports').then(i => { setItems(i); setError('') },
      (e: Error) => { if (e.message === '401' || e.message === '404') setAway(true); else setError('The queue did not load. Try again.') })
  }, [])
  // The session cookie goes with the request whatever this page thinks yet, so it asks straight away.
  useEffect(() => { if (config.enabled) load() }, [config.enabled, userId, load])

  if (away || !config.enabled) return <Navigate to="/" replace />
  if (!items && !error) return null
  return (
    <div className="screen">
      <Top />
      <div className="page">
        <main className="library">
          <section className="library-head">
            <div className="eyebrow">MODERATION</div>
            <h1>Reported lessons</h1>
            <p className="lede">Open reports, the most reported lesson first. Unpublishing or banning resolves the lesson's reports; dismissing closes them.</p>
          </section>
          {error ? <div className="cta-note bad" role="alert">{error}</div>
            : items && (items.length === 0
              ? <div className="library-empty sub">No open reports.</div>
              : <div className="mod-list">{items.map(i => <QueueCard key={i.lesson.id} item={i} done={load} />)}</div>)}
        </main>
      </div>
    </div>
  )
}

const ago = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function QueueCard({ item, done }: { item: Item; done: () => void }) {
  const { lesson } = item
  const [confirm, setConfirm] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async () => {
    setBusy(true)
    setError('')
    try {
      if (confirm === 'unpublish') await post(`/api/admin/lessons/${encodeURIComponent(lesson.id)}/unpublish`, { reason })
      else if (confirm === 'ban') await post(`/api/admin/users/${encodeURIComponent(lesson.author!.id)}/ban`)
      else await Promise.all(item.reports.map(r => post(`/api/admin/reports/${r.id}`, { action: 'dismiss' })))
      setConfirm(null)
      done()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const ask = (a: Action) => { setConfirm(a); setError(''); setReason('') }
  const question = confirm === 'unpublish' ? 'Unpublish this lesson? It leaves the library and nobody can start it. Shifts already going may finish. The author sees your reason.'
    : confirm === 'ban' ? `Ban ${lesson.author?.name}? They are signed out and can't sign in again, and all their lessons leave the library.`
    : `Dismiss ${item.count === 1 ? 'this report' : `these ${item.count} reports`}? The lesson stays up.`

  return (
    <article className="lesson-card mod-card">
      <div className="mod-head">
        <Link className="lesson-title link" to={`/lessons/${encodeURIComponent(lesson.id)}`}>{lesson.title}</Link>
        <span className="chip bad">{item.count} {item.count === 1 ? 'report' : 'reports'}</span>
      </div>
      <span className="sub">
        {lesson.author ? `By ${lesson.author.name}` : 'LARP original'}
        {lesson.hidden && ' · already unpublished'}{lesson.author?.banned && ' · author banned'}
      </span>
      <ul className="mod-reports">
        {item.reports.map(r => (
          <li key={r.id}>
            <span className="chip tag">{r.reason}</span>
            <span className="sub">{r.reporter} · {ago(r.createdAt)}</span>
            {r.note && <p>{r.note}</p>}
          </li>
        ))}
      </ul>
      {confirm ? (
        <div className="report">
          <div>{question}</div>
          {confirm === 'unpublish' && <textarea className="input" rows={2} maxLength={500} placeholder="Reason, shown to the author" aria-label="Reason" value={reason} onChange={e => setReason(e.target.value)} />}
          {error && <div className="cta-note bad" role="alert">{error}</div>}
          <div className="report-actions">
            <button className="btn sm btn-chip" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn sm btn-danger" disabled={busy || (confirm === 'unpublish' && !reason.trim())} onClick={() => void act()}>
              {busy ? 'Working...' : confirm === 'unpublish' ? 'Unpublish' : confirm === 'ban' ? 'Ban author' : 'Dismiss'}
            </button>
          </div>
        </div>
      ) : (
        <div className="report-actions">
          <button className="btn sm btn-chip" onClick={() => ask('dismiss')}>Dismiss</button>
          {lesson.author && !lesson.author.banned && <button className="btn sm btn-chip" onClick={() => ask('ban')}>Ban author</button>}
          {!lesson.hidden && <button className="btn sm btn-danger" onClick={() => ask('unpublish')}>Unpublish</button>}
        </div>
      )}
    </article>
  )
}
