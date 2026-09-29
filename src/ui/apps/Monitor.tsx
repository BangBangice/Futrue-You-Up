import { AnimatePresence, motion } from 'motion/react'
import { Undo2 } from 'lucide-react'
import { ALARM, CUSTOMERS, OTHER_ACCOUNTS, RATE, clock, errAt, lockedAt, lockedFor, money } from '../../../shared/types.ts'
import { live, sim, useSim } from '../../sim/store.ts'
import { LOGOS, SPRING } from '../bits.tsx'
import { DragBar, Lights } from '../Window.tsx'

const SPAN = 59 // minutes across the chart
const Y = (v: number) => 170 - (Math.min(v, 50) / 50) * 160

/** The 401 chart. Re-keyed every sim minute and slid one step left, so the line scrolls instead of jumping. */
function Chart() {
  const m = useSim(s => s.simMin)
  const deploys = useSim(s => s.deploys)
  const pace = useSim(s => s.pace)
  // One extra point on each side: the newest waits past the right edge and slides in.
  const from = m - 1 - SPAN
  const pts = Array.from({ length: SPAN + 2 }, (_, i) => `${((i / SPAN) * 600).toFixed(1)},${Y(errAt(deploys, from + i)).toFixed(1)}`).join(' ')
  return (
    <div className="chart">
      {[10, 20, 30, 40].map(v => <div key={v} className="grid-line" style={{ top: (Y(v) / 170) * 100 + '%' }}><span>{v}%</span></div>)}
      <div className="threshold" style={{ top: (Y(ALARM) / 170) * 100 + '%' }} />
      <div className="chart-clip">
        <div key={m} className="chart-slide" style={{ animationDuration: 60_000 / pace + 'ms' }}>
          <svg viewBox="0 0 600 170" preserveAspectRatio="none">
            <defs><linearGradient id="err-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ea580c" stopOpacity=".28" /><stop offset="1" stopColor="#ea580c" stopOpacity="0" /></linearGradient></defs>
            <polygon points={`0,170 ${pts} ${(((SPAN + 1) / SPAN) * 600).toFixed(1)},170`} fill="url(#err-fill)" />
            <polyline points={pts} fill="none" stroke="#ea580c" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {deploys.filter(d => d.at >= m - SPAN).map((d, i) => (
            <div key={d.sha + d.at} className={'marker ' + (d.kind === 'rollback' ? 'good' : 'accent')} style={{ left: ((d.at - from) / SPAN) * 100 + '%' }}><span style={{ top: (i % 3) * 18 }}>{d.kind === 'rollback' ? 'Rollback' : 'Deploy'} {d.sha}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Monitor() {
  const m = useSim(s => s.simMin)
  const deploys = useSim(s => s.deploys)
  const incident = useSim(s => s.incident)
  const timeline = useSim(s => s.timeline)
  const busy = useSim(s => s.code.busy)
  const on = live({ incident })
  const err = errAt(deploys, m), bad = err > ALARM, locked = lockedAt(deploys, m)
  const tiles = [
    { label: '401 rate', value: err.toFixed(1) + '%', sub: `threshold ${ALARM}%`, bad },
    { label: 'Login success', value: Math.max(0, 99.6 - err * 1.05).toFixed(1) + '%', sub: 'password + SSO', bad },
    { label: 'p95 latency', value: Math.round(182 + err * 2.4) + ' ms', sub: 'auth-api', bad: false },
    { label: 'Users locked out', value: locked.toLocaleString('en-US'), sub: on ? 'and climbing' : 'now', bad: locked > 0 },
  ]
  const end = incident?.resolvedAt ?? m
  const prod = deploys.at(-1)

  return (
    <div className="app">
      <DragBar className="titlebar">
        <Lights />
        <img className="title-logo wide" src={LOGOS.monitor} alt="" />
        <div className="stack title"><b>auth-api · prod</b><span>CloudWatch · us-east-1 · 6 pods · {prod?.sha}</span></div>
        <div className="grow" />
        <div className="views"><span className="on">Last 60 min</span></div>
      </DragBar>
      <div className="monitor">
        <div className="tiles">
          {tiles.map(t => <div key={t.label} className="panel tile-stat"><span>{t.label}</span><b className={t.bad ? 'bad' : ''}>{t.value}</b><span className="small">{t.sub}</span></div>)}
        </div>
        <div className="mon-row wide-left">
          <div className="panel">
            <div className="panel-head"><b>401 error rate</b><span>Dashed red: {ALARM}% alert threshold</span></div>
            <Chart />
            <div className="ticks">{[59, 44, 29, 14, 0].map(i => <span key={i}>{i === 0 ? 'now' : clock(m - i).replace(/ [AP]M/, '')}</span>)}</div>
          </div>
          <div className="panel">
            <div className="panel-head"><b>Incident</b><span className={'pill ' + (on ? 'fire' : incident ? 'ok' : '')}>{on ? 'Open' : incident ? 'Resolved' : 'None'}</span></div>
            {!incident ? <p className="sub">No active incidents on auth-api. Last incident: billing-worker queue lag, Monday.</p> : (
              <motion.div key={incident.id} className="incident" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
                <b>{incident.id} · auth-api@{incident.sha}</b>
                <dl>
                  <dt>Started</dt><dd>{clock(incident.startedAt)}</dd>
                  <dt>Duration</dt><dd>{end - incident.startedAt} min</dd>
                  <dt>Revenue exposed</dt><dd>{money((end - incident.startedAt) * RATE)}</dd>
                  <dt>Owner</dt><dd>Maya Chen</dd>
                </dl>
                {on && prod?.sha === incident.sha && <div className="recover"><button className="btn btn-danger" disabled={!!busy} onClick={() => sim.exec('ldg rollback auth-api')}><Undo2 size={14} strokeWidth={2.4} />Roll back release</button></div>}
                {on && prod?.sha !== incident.sha && <div className="progress"><i />Rolling out auth-api@{prod?.sha}…</div>}
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
            {!locked ? <div className="sub">No customers affected.</div> : (
              <div className="customers">
                <div className="cust head"><span>Account</span><span>ARR</span><span>Users locked out</span></div>
                {CUSTOMERS.filter(c => lockedFor(deploys, m, c) > 0).map(c => (
                  <div key={c.name} className="cust"><span><b>{c.name}</b>{c.note && <em>{c.note}</em>}</span><span>{c.arr}</span><span>{lockedFor(deploys, m, c)}</span></div>
                ))}
                <div className="sub small" style={{ paddingTop: 6 }}>+ {OTHER_ACCOUNTS} more accounts using email + password</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
