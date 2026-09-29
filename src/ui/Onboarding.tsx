import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Bug, ChartColumn, Check, ClipboardList, Cloud, LayoutDashboard, Server } from 'lucide-react'
import { LEVELS } from '../sim/data.ts'
import { sim, useSim } from '../sim/store.ts'
import { Avatar, Brand, Company, EASE, Segmented, ThemeToggle, rise, stagger } from './bits.tsx'

const ROLES = [['Backend developer', Server], ['Frontend developer', LayoutDashboard], ['Data analyst', ChartColumn], ['DevOps / SRE', Cloud], ['Product manager', ClipboardList], ['QA engineer', Bug]] as const
const DAYS = [['Setup · done', 'done'], ['First ticket', 'now'], ['Code review', ''], ['On-call', ''], ['Handoff', '']]

export function Onboarding() {
  const level = useSim(s => s.level)
  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <div className="topbar-right"><ThemeToggle /><span>Maya Chen</span><Avatar who="maya" size={28} /></div>
      </header>
      <motion.main className="onboard" variants={stagger(0.07, 0.05)} initial="hidden" animate="show">
        <section className="hero">
          <motion.div variants={rise} className="eyebrow">WORKPLACE SIMULATOR</motion.div>
          <motion.h1 variants={rise}>Sit at the desk before anyone hires you.</motion.h1>
          <motion.p variants={rise} className="lede">You get a work computer at a fictional company. Colleagues message you, clients escalate, and whatever you ship stays shipped. After the shift you get a debrief and a record employers can verify.</motion.p>
          <motion.div variants={rise} className="days">
            <div className="label">Your 5-day placement</div>
            <div className="days-row">
              {DAYS.map(([sub, state], i) => (
                <div key={i} className={'day ' + state}>
                  <div className="day-bar"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: state ? 1 : 0 }} transition={{ delay: 0.55 + i * 0.14, duration: 0.7, ease: EASE }} /></div>
                  <b>Day {i + 1}</b>
                  <span>{sub}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        <motion.section variants={rise} className="card setup">
          <div className="field">
            <div className="field-label">Role</div>
            <div className="roles">
              {ROLES.map(([name, Icon], i) => (
                <div key={name} className={'tile' + (i === 0 ? ' on' : ' soon')}>
                  <div className="tile-top"><Icon size={16} strokeWidth={2} />{i === 0 && <span className="tick"><Check size={11} strokeWidth={3.2} /></span>}</div>
                  <b>{name}</b>
                  <span>{i === 0 ? 'Available' : 'Soon'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <div className="field-label">Company</div>
            <div className="tile row on">
              <Company size={34} />
              <div className="grow"><b>Ledgerly</b><span>Invoicing SaaS · 40 people · Series A</span></div>
              <span className="tick"><Check size={11} strokeWidth={3.2} /></span>
            </div>
          </div>
          <div className="field">
            <div className="field-label">Starting level</div>
            <Segmented id="level" grow value={level} options={LEVELS.map(([k, label]) => [k, label])} onChange={v => sim.set({ level: v })} />
            <div className="level-note">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={level} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
                  {LEVELS.find(l => l[0] === level)![2]}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <p className="adapt">The sim adapts to your skill: hints, pacing and what colleagues expect of you shift with how you actually work.</p>
          <button className="cta" onClick={sim.start}>Start Day 2 at Ledgerly <ArrowRight size={17} strokeWidth={2.4} /></button>
          <div className="cta-note">About 10 minutes · 1 real second = 1 sim minute</div>
        </motion.section>
      </motion.main>
    </div>
  )
}
