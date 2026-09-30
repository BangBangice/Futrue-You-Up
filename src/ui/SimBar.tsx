import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Flag, Sparkles, TriangleAlert, WifiOff } from 'lucide-react'
import { clock, shortDay } from '../../shared/types.ts'
import { useAccount } from '../sim/auth.ts'
import { guide } from '../sim/guide.ts'
import { sim, useSim } from '../sim/store.ts'
import { Brand, ThemeToggle } from './bits.tsx'

/** The server ticks whole sim-minutes. Fill in the seconds between ticks so a change of pace shows at once. */
function useSimSeconds(m: number, pace: number, running: boolean) {
  const since = useRef({ m, pace, at: Date.now(), base: 0 })
  const [, redraw] = useState(0)
  const at = (a: typeof since.current, now: number) => Math.min(59, a.base + Math.floor(((now - a.at) / 1000) * a.pace))
  // A new minute starts from zero. A new pace carries on from the seconds already shown.
  if (since.current.m !== m) since.current = { m, pace, at: Date.now(), base: 0 }
  else if (since.current.pace !== pace) since.current = { m, pace, at: Date.now(), base: at(since.current, Date.now()) }
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => redraw(n => n + 1), 250)
    return () => clearInterval(t)
  }, [running])
  return running ? at(since.current, Date.now()) : 0
}

export function SimBar() {
  const m = useSim(s => s.simMin)
  const pace = useSim(s => s.pace)
  const ai = useSim(s => s.ai)
  const aiProblem = useSim(s => s.aiProblem)
  const online = useSim(s => s.online)
  const stage = useSim(s => s.stage)
  const sec = useSimSeconds(m, pace, stage === 'sim' && online)
  const account = useAccount()
  const company = useSim(s => s.company), role = useSim(s => s.cast[s.player]?.title)
  const cal = useSim(s => s.calendar)
  // Finishing with the work done ends the lesson at once. Before that, it asks: a click there is usually a slip or a wish to stop.
  const ready = useSim(s => guide(s).ready)
  const [asking, setAsking] = useState(false)
  return (
    <header className="simbar">
      <Brand size={14} />
      <div className="simbar-role">
        <i className="vsep" />
        <div className="stack"><b>{role} · {company}</b><span>Day {cal.day} · {shortDay(cal.weekday)}, {cal.date}</span></div>
      </div>
      <div className="stack simclock"><b>{clock(m, sec)}</b><span>SIM TIME</span></div>
      {aiProblem
        ? <span className="chip bad" role="alert" title={`AI calls are failing: ${aiProblem}. Colleagues fall back to scripted lines until it recovers.`}><TriangleAlert size={12} strokeWidth={2.4} /><span className="ellipsis">AI unavailable: {aiProblem}</span></span>
        : <span className="chip" title={ai === 'live' ? 'Colleagues are played by an AI model' : 'Colleagues use scripted lines. No network needed.'}><Sparkles size={12} strokeWidth={2.2} />{ai === 'live' ? 'AI colleagues' : 'Scripted colleagues'}</span>}
      <div className="grow" />
      <AnimatePresence>
        {!online && <motion.span key="off" className="chip bad" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}><WifiOff size={12} strokeWidth={2.4} />Reconnecting</motion.span>}
      </AnimatePresence>
      {account?.isAnonymous && account.save && <button className="btn btn-soft" onClick={account.save}>Save your progress</button>}
      <ThemeToggle />
      <button className="btn btn-ink" data-guide="end-shift" aria-expanded={asking} onClick={() => (ready ? sim.endShift() : setAsking(a => !a))}><Flag size={14} strokeWidth={2.4} />Finish lesson</button>
      {createPortal(<AnimatePresence>
        {asking && (
          <motion.div key="ask" className="finish-ask" role="dialog" aria-label="Finish the lesson early?" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }} transition={{ duration: 0.16 }}>
            <b>Finish before you’re done?</b>
            <span className="sub">Your steps aren’t all done yet. You’ll get a recap of what you did so far, and can start the lesson again any time.</span>
            <div className="finish-ask-row">
              <button className="btn btn-soft sm" autoFocus onClick={() => setAsking(false)}>Keep going</button>
              <button className="btn btn-ink sm" onClick={() => { setAsking(false); sim.endShift() }}>Finish now</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </header>
  )
}
