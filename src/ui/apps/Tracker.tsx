import { useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, SendHorizontal } from 'lucide-react'
import { COLS, PRIORITIES } from '../../../shared/types.ts'
import type { PersonId, Priority, Ticket, TicketStatus } from '../../../shared/types.ts'
import { sim, useSim } from '../../sim/store.ts'
import { Avatar, EASE, LOGOS, SPRING } from '../bits.tsx'
import { Rich } from '../files.tsx'
import { DragBar, Lights } from '../Window.tsx'

const TEAM: PersonId[] = ['maya', 'daniel', 'leo', 'priya']
const Pri = ({ p }: { p: Priority }) => <span className={'pri ' + p.toLowerCase()}>{p}</span>

/** Text that turns into a field when clicked, and saves when you leave it. */
function Editable({ value, onSave, multiline, label }: { value: string; onSave: (v: string) => void; multiline?: boolean; label: string }) {
  const [editing, setEditing] = useState(false)
  const done = (v: string) => { setEditing(false); if (v.trim() && v !== value) onSave(v.trim()) }
  if (!editing) return <div className="editable" role="button" tabIndex={0} title="Click to edit" onClick={() => setEditing(true)} onKeyDown={e => e.key === 'Enter' && setEditing(true)}>{multiline ? <Rich text={value || 'Add a description'} /> : value}</div>
  return multiline
    ? <textarea className="input" autoFocus rows={6} defaultValue={value} aria-label={label} onBlur={e => done(e.target.value)} onKeyDown={e => e.key === 'Escape' && setEditing(false)} />
    : <input className="input" autoFocus defaultValue={value} aria-label={label} onBlur={e => done(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') done(e.currentTarget.value); if (e.key === 'Escape') setEditing(false) }} />
}

function Detail({ tk }: { tk: Ticket }) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')
  const cast = useSim(s => s.cast)
  const locked = tk.id.startsWith('INC') // incidents follow production, not the board
  const comment = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const text = new FormData(e.currentTarget).get('text')?.toString().trim()
    if (text) { void sim.comment(tk.id, text); e.currentTarget.reset() }
  }
  return (
    <motion.div key={tk.id} className="ticket-detail" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.26, ease: EASE }}>
      <div className="ticket-id">{tk.id}{tk.reopened && <span className="pri reopened">Reopened</span>}</div>
      <h3><Editable label="Title" value={tk.title} onSave={title => sim.saveTicket(tk.id, { title })} /></h3>
      <dl>
        <dt>Status</dt>
        <dd><select className="select" data-guide="ticket-status" value={tk.status} disabled={locked} aria-label="Status" onChange={e => sim.saveTicket(tk.id, { status: e.target.value as TicketStatus })}>{COLS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></dd>
        <dt>Assignee</dt>
        <dd className="assignee">{tk.who && <Avatar who={tk.who} size={18} />}<select className="select" value={tk.who ?? ''} aria-label="Assignee" onChange={e => sim.saveTicket(tk.id, { who: (e.target.value || null) as PersonId | null })}><option value="">Unassigned</option>{TEAM.map(p => <option key={p} value={p}>{cast[p].name}</option>)}</select></dd>
        <dt>Priority</dt>
        <dd><select className="select" value={tk.pri} aria-label="Priority" onChange={e => sim.saveTicket(tk.id, { pri: e.target.value as Priority })}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></dd>
        <dt>Estimate</dt><dd>{tk.pts ? tk.pts + ' pts' : '—'}</dd>
      </dl>
      <div className="ticket-desc"><Editable multiline label="Description" value={tk.desc} onSave={desc => sim.saveTicket(tk.id, { desc })} /></div>
      <div className="ticket-actions">
        {tk.id.startsWith('LED') && tk.status !== 'done' && <button className="btn btn-soft sm" onClick={() => sim.openCode('src/auth/verifySession.ts')}>Open in VS Code</button>}
        {locked && <button className="btn btn-soft sm" onClick={() => sim.open('monitor')}>Open in CloudWatch</button>}
        {locked && <button className="btn btn-soft sm" onClick={() => sim.openChat('incidents')}>Open #incidents</button>}
      </div>
      <div className="ticket-tabs">
        <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>Comments {tk.comments.length > 0 && tk.comments.length}</button>
        <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity</button>
      </div>
      {tab === 'activity' ? tk.activity.toReversed().map((a, i) => <div key={i} className="activity-row"><time>{a.time}</time><span>{a.text}</span></div>) : (
        <>
          <AnimatePresence initial={false}>
            {tk.comments.map((c, i) => (
              <motion.div key={i} className="comment" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
                <Avatar who={c.who} size={24} />
                <div><div className="comment-head"><b>{cast[c.who].name}</b><time>{c.time}</time></div><p><Rich text={c.text} /></p></div>
              </motion.div>
            ))}
          </AnimatePresence>
          <form className="comment-new" onSubmit={comment}>
            <input name="text" className="input" placeholder="Add a comment" aria-label="Add a comment" autoComplete="off" />
            <button className="icon-btn ghost" aria-label="Post comment"><SendHorizontal size={15} strokeWidth={2.2} /></button>
          </form>
        </>
      )}
    </motion.div>
  )
}

export function Tracker() {
  const tickets = useSim(s => s.tickets)
  const selId = useSim(s => s.ticketSel)
  const [over, setOver] = useState<TicketStatus | null>(null)
  const [adding, setAdding] = useState(false)
  const tk = tickets.find(t => t.id === selId)

  const drop = (e: DragEvent, status: TicketStatus) => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain'), t = tickets.find(x => x.id === id)
    if (t && t.status !== status && !id.startsWith('INC')) void sim.saveTicket(id, { status })
  }
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const title = new FormData(e.currentTarget).get('title')?.toString().trim()
    setAdding(false)
    if (title) void sim.saveTicket(undefined, { title })
  }

  return (
    <div className="app">
      <DragBar className="titlebar">
        <Lights />
        <img className="title-logo" src={LOGOS.tracker} alt="" />
        <div className="stack title"><b>LED · Sprint 14</b><span>Auth &amp; Identity · Sep 22 – Oct 3</span></div>
        <div className="grow" />
        <div className="views"><span className="on">Board</span><span>Backlog</span><span>Reports</span></div>
        <button className="btn btn-accent sm" onClick={() => setAdding(true)}><Plus size={14} strokeWidth={2.6} />Create</button>
      </DragBar>
      <div className="app-body">
        <motion.div layoutScroll className="board">
          {COLS.map(([k, label]) => {
            const cards = tickets.filter(t => t.status === k)
            return (
              <div key={k} className={'col' + (over === k ? ' over' : '')} onDragOver={e => { e.preventDefault(); setOver(k) }} onDragLeave={() => setOver(o => (o === k ? null : o))} onDrop={e => drop(e, k)}>
                <div className="col-head"><span>{label}</span><span>{cards.length}</span></div>
                {k === 'todo' && adding && <form onSubmit={create}><input name="title" className="input" autoFocus placeholder="What needs doing?" aria-label="New issue title" onBlur={() => setAdding(false)} /></form>}
                <AnimatePresence initial={false}>
                  {cards.map(t => (
                    <motion.div key={t.id} layout layoutId={t.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING}>
                      <button className={'ticket' + (t.id === selId ? ' on' : '')} data-guide={'ticket:' + t.id} draggable={!t.id.startsWith('INC')} onDragStart={e => e.dataTransfer.setData('text/plain', t.id)} onClick={() => sim.set({ ticketSel: t.id })}>
                        <div className="ticket-title">{t.title}</div>
                        <div className="ticket-meta">
                          <span className="ticket-id">{t.id}</span>
                          <Pri p={t.pri} />
                          {t.reopened && <span className="pri reopened">Reopened</span>}
                          <div className="grow" />
                          {t.who && <Avatar who={t.who} size={20} />}
                        </div>
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )
          })}
        </motion.div>
        {tk && <aside className="ticket-panel"><Detail tk={tk} /></aside>}
      </div>
    </div>
  )
}
