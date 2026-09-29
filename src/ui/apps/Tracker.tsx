import { AnimatePresence, motion } from 'motion/react'
import { COLS, PEOPLE } from '../../sim/data.ts'
import type { Ticket } from '../../sim/data.ts'
import { sim, useSim } from '../../sim/store.ts'
import { Avatar, EASE, LOGOS, SPRING } from '../bits.tsx'
import { Rich } from '../files.tsx'
import { DragBar, Lights } from '../Window.tsx'

const Pri = ({ p }: { p: Ticket['pri'] }) => <span className={'pri ' + p.toLowerCase()}>{p}</span>

export function Tracker() {
  const tickets = useSim(s => s.tickets)
  const selId = useSim(s => s.ticketSel)
  const tk = tickets.find(t => t.id === selId)

  return (
    <div className="app">
      <DragBar className="titlebar">
        <Lights />
        <img className="title-logo" src={LOGOS.tracker} alt="" />
        <div className="stack title"><b>LED · Sprint 14</b><span>Auth &amp; Identity · Sep 22 – Oct 3</span></div>
        <div className="grow" />
        <div className="views"><span className="on">Board</span><span>Backlog</span><span>Reports</span></div>
      </DragBar>
      <div className="app-body">
        <motion.div layoutScroll className="board">
          {COLS.map(([k, label]) => {
            const cards = tickets.filter(t => t.status === k)
            return (
              <div key={k} className="col">
                <div className="col-head"><span>{label}</span><span>{cards.length}</span></div>
                <AnimatePresence initial={false}>
                  {cards.map(t => (
                    <motion.button key={t.id} layout layoutId={t.id} className={'ticket' + (t.id === selId ? ' on' : '')} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING} onClick={() => sim.set({ ticketSel: t.id })}>
                      <div className="ticket-title">{t.title}</div>
                      <div className="ticket-meta">
                        <span className="ticket-id">{t.id}</span>
                        <Pri p={t.pri} />
                        {t.reopened && <span className="pri reopened">Reopened</span>}
                        <div className="grow" />
                        {t.who && <Avatar who={t.who} size={20} />}
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            )
          })}
        </motion.div>
        {tk && (
          <aside className="ticket-panel">
            <motion.div key={tk.id} className="ticket-detail" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.26, ease: EASE }}>
              <div className="ticket-id">{tk.id}</div>
              <h3>{tk.title}</h3>
              <dl>
                <dt>Status</dt><dd><b>{COLS.find(c => c[0] === tk.status)![1]}{tk.reopened ? ' · reopened' : ''}</b></dd>
                <dt>Assignee</dt><dd className="assignee">{tk.who && <Avatar who={tk.who} size={18} />}{tk.who ? PEOPLE[tk.who].name : 'Unassigned'}</dd>
                <dt>Priority</dt><dd><Pri p={tk.pri} /></dd>
                <dt>Estimate</dt><dd>{tk.pts ? tk.pts + ' pts' : '—'}</dd>
              </dl>
              <p><Rich text={tk.desc} /></p>
              <div className="ticket-actions">
                {tk.id === 'LED-214' && tk.status === 'todo' && <button className="btn btn-soft" onClick={sim.startTicket}>Start progress</button>}
                {tk.id === 'LED-214' && tk.status !== 'done' && <button className="btn btn-soft" onClick={() => sim.openCode('vs')}>Open in VS Code</button>}
                {tk.id === 'INC-37' && <button className="btn btn-soft" onClick={() => sim.open('monitor')}>Open in CloudWatch</button>}
                {tk.id === 'INC-37' && <button className="btn btn-soft" onClick={() => sim.openChat('incidents')}>Open #incidents</button>}
              </div>
            </motion.div>
          </aside>
        )}
      </div>
    </div>
  )
}
