import { AnimatePresence, motion } from 'motion/react'
import { LogOut } from 'lucide-react'
import { DEMO, LIVE, METERS, RATE, clock, dur, money } from '../sim/data.ts'
import type { MeterId } from '../sim/data.ts'
import { lockedAt } from '../sim/engine.ts'
import { sim, useSim } from '../sim/store.ts'
import { Brand, SPRING, ThemeToggle } from './bits.tsx'

function Meter({ id, long, short }: { id: MeterId; long: string; short: string }) {
  const v = useSim(s => s.meters[id])
  const flash = useSim(s => s.flash[id])
  const tone = v >= 60 ? 'good' : v >= 40 ? 'warn' : 'bad'
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label"><span className="long">{long}</span><span className="short">{short}</span></span>
        <span className="meter-val">
          <AnimatePresence>
            {flash && (
              <motion.span key={flash.id} className={'flash ' + (flash.d > 0 ? 'up' : 'down')} initial={{ opacity: 0, scale: 0.5, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SPRING}>
                {flash.d > 0 ? '+' + flash.d : '−' + Math.abs(flash.d)}
              </motion.span>
            )}
          </AnimatePresence>
          <b>{v}</b>
        </span>
      </div>
      <div className="track"><motion.i className={tone} initial={false} animate={{ width: v + '%' }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} /></div>
    </div>
  )
}

export function SimBar() {
  const m = useSim(s => s.simMin)
  const live = useSim(s => LIVE.includes(s.phase))
  const f = useSim(s => s.f)
  const toDemo = DEMO - m
  return (
    <header className={'simbar' + (live ? ' compact' : '')}>
      <Brand size={14} />
      <div className="simbar-role">
        <i className="vsep" />
        <div className="stack"><b>Backend Developer · Ledgerly</b><span>Day 2 of 5 · Tue, Sep 29</span></div>
      </div>
      <div className="stack simclock"><b>{clock(m)}</b><span>SIM TIME</span></div>
      <div className="meters">{METERS.map(([id, long, short]) => <Meter key={id} id={id} long={long} short={short} />)}</div>
      <div className="grow" />
      <AnimatePresence>
        {live && (
          <motion.div className="live" initial={{ opacity: 0, x: 24, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 24, scale: 0.9 }} transition={SPRING}>
            <i />
            <span>{toDemo > 0 ? 'Demo in ' + dur(toDemo) : 'Demo missed'}</span><em>·</em>
            <span>{money((m - f.incident!) * RATE)} at risk</span><em>·</em>
            <span>{lockedAt(f, m).toLocaleString('en-US')} locked out</span>
          </motion.div>
        )}
      </AnimatePresence>
      <ThemeToggle />
      <button className="btn btn-ink" onClick={sim.endShift}><LogOut size={14} strokeWidth={2.4} />End shift</button>
    </header>
  )
}
