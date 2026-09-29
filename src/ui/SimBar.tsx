import { AnimatePresence, motion } from 'motion/react'
import { LogOut, Sparkles, WifiOff } from 'lucide-react'
import { DEMO, PACES, RATE, clock, dur, lockedAt, money } from '../../shared/types.ts'
import { live, sim, useSim } from '../sim/store.ts'
import { Brand, SPRING, Segmented, ThemeToggle } from './bits.tsx'

export function SimBar() {
  const m = useSim(s => s.simMin)
  const incident = useSim(s => s.incident)
  const deploys = useSim(s => s.deploys)
  const pace = useSim(s => s.pace)
  const ai = useSim(s => s.ai)
  const online = useSim(s => s.online)
  const on = live({ incident }), toDemo = DEMO - m
  return (
    <header className={'simbar' + (on ? ' compact' : '')}>
      <Brand size={14} />
      <div className="simbar-role">
        <i className="vsep" />
        <div className="stack"><b>Backend Developer · Ledgerly</b><span>Day 2 of 5 · Tue, Sep 29</span></div>
      </div>
      <div className="stack simclock"><b>{clock(m)}</b><span>SIM TIME</span></div>
      <Segmented id="pace" value={String(pace)} options={PACES.map(([n, label]) => [String(n), label])} onChange={v => sim.setPace(Number(v))} />
      <span className="chip" title={ai === 'live' ? 'Colleagues are played by an AI model' : 'Colleagues use scripted lines. No network needed.'}><Sparkles size={12} strokeWidth={2.2} />{ai === 'live' ? 'AI colleagues' : 'Scripted colleagues'}</span>
      <div className="grow" />
      <AnimatePresence>
        {!online && <motion.span key="off" className="chip bad" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}><WifiOff size={12} strokeWidth={2.4} />Reconnecting</motion.span>}
        {on && (
          <motion.div key="live" className="live" initial={{ opacity: 0, x: 24, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24, scale: 0.9 }} transition={SPRING}>
            <i />
            <span>{toDemo > 0 ? 'Demo in ' + dur(toDemo) : 'Demo missed'}</span><em>·</em>
            <span>{money((m - incident!.startedAt) * RATE)} at risk</span><em>·</em>
            <span>{lockedAt(deploys, m).toLocaleString('en-US')} locked out</span>
          </motion.div>
        )}
      </AnimatePresence>
      <ThemeToggle />
      <button className="btn btn-ink" onClick={sim.endShift}><LogOut size={14} strokeWidth={2.4} />End shift</button>
    </header>
  )
}
