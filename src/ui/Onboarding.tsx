import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Bug, ChartColumn, Check, ClipboardList, Cloud, LayoutDashboard, LoaderCircle, Server, TriangleAlert } from 'lucide-react'
import { LEVELS } from '../../shared/types.ts'
import { useAccount } from '../sim/auth.ts'
import { sim, useSim } from '../sim/store.ts'
import { Avatar, Brand, EASE, Segmented, ThemeToggle, rise, stagger } from './bits.tsx'

const ROLES = [['Backend developer', Server], ['Frontend developer', LayoutDashboard], ['Data analyst', ChartColumn], ['DevOps / SRE', Cloud], ['Product manager', ClipboardList], ['QA engineer', Bug]] as const
const DAYS = [['Setup · done', 'done'], ['First ticket', 'now'], ['Code review', ''], ['On-call', ''], ['Handoff', '']]

export function Onboarding() {
  const level = useSim(s => s.level)
  const background = useSim(s => s.background)
  const starting = useSim(s => s.starting)
  const error = useSim(s => s.error)
  const aiProblem = useSim(s => s.aiProblem)
  const player = useSim(s => s.player), me = useSim(s => s.cast[s.player])
  const account = useAccount()
  useEffect(() => { void sim.checkAi(); void sim.loadCast() }, [])
  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          {account && <><span>{account.name}</span><button className="btn sm btn-chip" onClick={() => void account.signOut()}>Sign out</button></>}
          <ThemeToggle />{me && <><span>{me.name}</span><Avatar who={player} size={28} /></>}</div>
      </header>
      <motion.main className="onboard" variants={stagger(0.07, 0.05)} initial="hidden" animate="show">
        <section className="hero">
          <motion.div variants={rise} className="eyebrow">WORKPLACE SIMULATOR</motion.div>
          <motion.h1 variants={rise}>Get it wrong here, with someone to correct you.</motion.h1>
          <motion.p variants={rise} className="lede">You get a work computer, a real codebase and a real ticket. Colleagues message you, clients escalate, and what you ship decides what happens next. When it goes wrong, a senior engineer steps in, shows you who it affected, and helps you put it right.</motion.p>
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
            <div className="field-label">Where you are starting from</div>
            <Segmented id="level" grow value={level} options={LEVELS.map(([k, label]) => [k, label])} onChange={v => sim.set({ level: v })} />
            <div className="level-note">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={level} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
                  {LEVELS.find(l => l[0] === level)![2]}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <label className="field">
            <div className="field-label">What did you do before this? <span className="sub">Optional</span></div>
            <textarea className="input" rows={2} maxLength={400} value={background} onChange={e => sim.set({ background: e.target.value })} placeholder="For example: six years as a hospital pharmacist, or a computer science degree and one internship" />
            <div className="level-note">Your mentor uses this to explain things in terms you already know.</div>
          </label>
          {aiProblem && (
            <div className="ai-warn" role="alert">
              <TriangleAlert size={16} strokeWidth={2.2} />
              <div><b>AI colleagues are unavailable</b><span>{aiProblem[0].toUpperCase() + aiProblem.slice(1)}. You can still start: colleagues will use scripted lines. Check PERPLEXITY_API_KEY and PERPLEXITY_MODEL in .env, then restart the server.</span></div>
            </div>
          )}
          <button className="cta" disabled={starting} onClick={sim.start}>
            {starting ? <><LoaderCircle size={17} className="spin" />Setting up your workstation</> : <>Start Day 2 <ArrowRight size={17} strokeWidth={2.4} /></>}
          </button>
          {error ? <div className="cta-note bad">{error}</div> : <div className="cta-note">About 25 minutes · No score at the end</div>}
        </motion.section>
      </motion.main>
    </div>
  )
}
