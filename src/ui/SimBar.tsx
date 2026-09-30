import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LogOut, Sparkles, TriangleAlert, WifiOff } from 'lucide-react'
import { PACES, RATE, clock, dur, lockedAt, money, paceTip, shortDay } from '../../shared/types.ts'
import { DAYS } from '../../shared/scenario.ts'
import { useAccount } from '../sim/auth.ts'
import { live, sim, useSim } from '../sim/store.ts'
import { Brand, SPRING, Segmented, ThemeToggle } from './bits.tsx'

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
  const incident = useSim(s => s.incident)
  const deploys = useSim(s => s.deploys)
  const pace = useSim(s => s.pace)
  const ai = useSim(s => s.ai)
  const aiProblem = useSim(s => s.aiProblem)
  const online = useSim(s => s.online)
  const impact = useSim(s => s.impact)
  const deadline = useSim(s => s.deadline)
  const stage = useSim(s => s.stage)
  const sec = useSimSeconds(m, pace, stage === 'sim' && online)
  const tip = paceTip(pace, PACES.find(p => p[0] === pace)?.[1] ?? 'Custom')
  const account = useAccount()
  const company = useSim(s => s.company)
  const cal = useSim(s => s.calendar)
  const on = live({ incident }), toDemo = deadline === null ? null : deadline - m
  return (
    <header className={'simbar' + (on ? ' compact' : '')}>
      <Brand size={14} />
      <div className="simbar-role">
        <i className="vsep" />
        <div className="stack"><b>Backend Developer · {company}</b><span>Day {cal.day} of {DAYS} · {shortDay(cal.weekday)}, {cal.date}</span></div>
      </div>
      <div className="stack simclock" title={tip}><b>{clock(m, sec)}</b><span>SIM TIME</span></div>
      <Segmented id="pace" value={String(pace)} options={PACES.map(([n, label]) => [String(n), label, paceTip(n, label)])} onChange={v => sim.setPace(Number(v))} />
      {/* The same control for a phone, where three buttons do not fit (mobile.css shows one or the other). */}
      <select className="select pace-select" value={pace} aria-label="Pace" title={tip} onChange={e => sim.setPace(Number(e.target.value))}>{PACES.map(([n, label]) => <option key={n} value={n}>{label}</option>)}</select>
      {aiProblem
        ? <span className="chip bad" role="alert" title={`AI calls are failing: ${aiProblem}. Colleagues fall back to scripted lines until it recovers.`}><TriangleAlert size={12} strokeWidth={2.4} /><span className="ellipsis">AI unavailable: {aiProblem}</span></span>
        : <span className="chip" title={ai === 'live' ? 'Colleagues are played by an AI model' : 'Colleagues use scripted lines. No network needed.'}><Sparkles size={12} strokeWidth={2.2} />{ai === 'live' ? 'AI colleagues' : 'Scripted colleagues'}</span>}
      <div className="grow" />
      <AnimatePresence>
        {!online && <motion.span key="off" className="chip bad" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}><WifiOff size={12} strokeWidth={2.4} />Reconnecting</motion.span>}
        {on && (
          <motion.div key="live" className="live" initial={{ opacity: 0, x: 24, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24, scale: 0.9 }} transition={SPRING}>
            <i />
            {toDemo !== null && <><span>{toDemo > 0 ? 'Demo in ' + dur(toDemo) : 'Demo missed'}</span><em>·</em></>}
            <span>{money((m - incident!.startedAt) * RATE)} at risk</span><em>·</em>
            <span>{lockedAt(impact, deploys, m).toLocaleString('en-US')} locked out</span>
          </motion.div>
        )}
      </AnimatePresence>
      {account?.isAnonymous && account.save && <button className="btn btn-soft" onClick={account.save}>Save your progress</button>}
      <ThemeToggle />
      <button className="btn btn-ink" data-guide="end-shift" onClick={sim.endShift}><LogOut size={14} strokeWidth={2.4} />End shift</button>
    </header>
  )
}
