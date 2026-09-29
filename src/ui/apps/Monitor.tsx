import { AnimatePresence, motion } from 'motion/react'
import { Undo2, Wrench } from 'lucide-react'
import { CUSTOMERS, LIVE, RATE, clock, money } from '../../sim/data.ts'
import { errAt, lockedAt } from '../../sim/engine.ts'
import { sim, useSim } from '../../sim/store.ts'
import { LOGOS, SPRING } from '../bits.tsx'
import { DragBar, Lights } from '../Window.tsx'

const SPAN = 59 // minutes across the chart
const Y = (v: number) => 170 - (Math.min(v, 50) / 50) * 160

/** The 401 chart. Re-keyed every sim minute and slid one step left, so the line scrolls instead of jumping. */
function Chart() {
  const m = useSim(s => s.simMin)
  const f = useSim(s => s.f)
  // One extra point on each side: the newest waits past the right edge and slides in.
  const from = m - 1 - SPAN
  const pts = Array.from({ length: SPAN + 2 }, (_, i) => `${((i / SPAN) * 600).toFixed(1)},${Y(errAt(f, from + i)).toFixed(1)}`).join(' ')
  const marker = (at: number | undefined, label: string, tone: string) =>
    at !== undefined && at >= m - SPAN && <div className={'marker ' + tone} style={{ left: ((at - from) / SPAN) * 100 + '%' }}><span>{label}</span></div>
  return (
    <div className="chart">
      {[10, 20, 30, 40].map(v => <div key={v} className="grid-line" style={{ top: (Y(v) / 170) * 100 + '%' }}><span>{v}%</span></div>)}
      <div className="threshold" style={{ top: (Y(5) / 170) * 100 + '%' }} />
      <div className="chart-clip">
        <div key={m} className="chart-slide" style={{ animationDuration: 1000 / sim.speed + 'ms' }}>
          <svg viewBox="0 0 600 170" preserveAspectRatio="none">
            <defs><linearGradient id="err-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ea580c" stopOpacity=".28" /><stop offset="1" stopColor="#ea580c" stopOpacity="0" /></linearGradient></defs>
            <polygon points={`0,170 ${pts} ${(((SPAN + 1) / SPAN) * 600).toFixed(1)},170`} fill="url(#err-fill)" />
            <polyline points={pts} fill="none" stroke="#ea580c" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {marker(f.deploy, 'Deploy a41f9c2', 'accent')}
          {marker(f.choiceAt, f.choice === 'revert' ? 'Rollback' : 'Patch', 'good')}
        </div>
      </div>
    </div>
  )
}

export function Monitor() {
  const m = useSim(s => s.simMin)
  const f = useSim(s => s.f)
  const phase = useSim(s => s.phase)
  const timeline = useSim(s => s.timeline)
  const live = LIVE.includes(phase)
  const err = errAt(f, m), bad = err > 5, locked = live ? lockedAt(f, m) : 0
  const tiles = [
    { label: '401 rate', value: err.toFixed(1) + '%', sub: 'threshold 5%', bad },
    { label: 'Login success', value: Math.max(0, 99.6 - err * 1.05).toFixed(1) + '%', sub: 'password + SSO', bad },
    { label: 'p95 latency', value: Math.round(182 + err * 2.4) + ' ms', sub: 'auth-api', bad: false },
    { label: 'Users locked out', value: locked.toLocaleString('en-US'), sub: live ? 'and climbing' : 'now', bad: locked > 0 },
  ]
  const frac = f.incident !== undefined ? Math.min(1, (m - f.incident + 2) / 12) : 0
  const status = live ? (phase === 'incident' ? 'Open' : phase === 'patching' ? 'Patching' : 'Rolling back') : phase === 'resolved' ? 'Resolved' : 'None'
  const end = f.resolved ?? m

  return (
    <div className="app">
      <DragBar className="titlebar">
        <Lights />
        <img className="title-logo wide" src={LOGOS.monitor} alt="" />
        <div className="stack title"><b>auth-api · prod</b><span>CloudWatch · us-east-1 · 6 pods</span></div>
        <div className="grow" />
        <div className="views"><span className="on">Last 60 min</span></div>
      </DragBar>
      <div className="monitor">
        <div className="tiles">
          {tiles.map(t => (
            <div key={t.label} className="panel tile-stat">
              <span>{t.label}</span><b className={t.bad ? 'bad' : ''}>{t.value}</b><span className="small">{t.sub}</span>
            </div>
          ))}
        </div>
        <div className="mon-row wide-left">
          <div className="panel">
            <div className="panel-head"><b>401 error rate</b><span>Dashed red: 5% alert threshold</span></div>
            <Chart />
            <div className="ticks">{[59, 44, 29, 14, 0].map(i => <span key={i}>{i === 0 ? 'now' : clock(m - i).replace(/ [AP]M/, '')}</span>)}</div>
          </div>
          <div className="panel">
            <div className="panel-head"><b>Incident</b><span className={'pill ' + (live ? 'fire' : phase === 'resolved' ? 'ok' : '')}>{status}</span></div>
            {f.incident === undefined ? <p className="sub">No active incidents on auth-api. Last incident: billing-worker queue lag, Monday.</p> : (
              <motion.div className="incident" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
                <b>INC-37 · Password logins failing on auth-api</b>
                <dl>
                  <dt>Started</dt><dd>{clock(f.incident)}</dd>
                  <dt>Duration</dt><dd>{end - f.incident} min</dd>
                  <dt>Revenue exposed</dt><dd>{money((end - f.incident) * RATE)}</dd>
                  <dt>Owner</dt><dd>Maya Chen</dd>
                </dl>
                {phase === 'incident' && (
                  <div className="recover">
                    <button className="btn btn-danger" onClick={sim.revert}><Undo2 size={14} strokeWidth={2.4} />Revert deploy</button>
                    <button className="btn btn-chip" onClick={sim.patch}><Wrench size={14} strokeWidth={2.2} />Patch forward</button>
                  </div>
                )}
                {(phase === 'patching' || phase === 'recovering') && <div className="progress"><i />{phase === 'patching' ? 'Deploying c83d1b7 (cookie fallback)…' : 'Rolling back to 7c19e02…'}</div>}
              </motion.div>
            )}
          </div>
        </div>
        <div className="mon-row">
          <div className="panel">
            <b>Timeline</b>
            <AnimatePresence initial={false}>
              {timeline.toReversed().map(ev => (
                <motion.div layout key={ev.time + ev.text} className="event" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={SPRING}>
                  <i className={ev.tone} /><time>{ev.time}</time><span>{ev.text}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div className="panel">
            <b>Affected customers</b>
            {!live ? <div className="sub">No customers affected.</div> : (
              <div className="customers">
                <div className="cust head"><span>Account</span><span>ARR</span><span>Users locked out</span></div>
                {CUSTOMERS.map(c => (
                  <div key={c.name} className="cust">
                    <span><b>{c.name}</b>{c.note && <em>{c.note}</em>}</span><span>{c.arr}</span><span>{Math.round(c.base * frac)}</span>
                  </div>
                ))}
                <div className="sub small" style={{ paddingTop: 6 }}>+ 214 more accounts using email + password</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
