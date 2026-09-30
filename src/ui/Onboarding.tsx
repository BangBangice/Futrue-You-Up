import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, LoaderCircle, TriangleAlert } from 'lucide-react'
import { LEVELS, initials } from '../../shared/types.ts'
import { useAccount } from '../sim/auth.ts'
import { sim, useSim } from '../sim/store.ts'
import { Avatar, Brand, Segmented, ThemeToggle, rise, stagger } from './bits.tsx'

export function Onboarding() {
  const level = useSim(s => s.level), levels = useSim(s => s.levels)
  const background = useSim(s => s.background)
  const starting = useSim(s => s.starting)
  const error = useSim(s => s.error)
  const aiProblem = useSim(s => s.aiProblem)
  const lesson = useSim(s => s.lesson), company = useSim(s => s.company)
  const player = useSim(s => s.player), me = useSim(s => s.cast[s.player])
  const account = useAccount()
  useEffect(() => { void sim.checkAi(); void sim.loadCast() }, [])
  return (
    <div className="page">
      <header className="topbar">
        <Brand home />
        <div className="topbar-right">
          {account?.isAnonymous && account.save && <button className="btn sm btn-soft" onClick={account.save}><span>Save<span className="wide"> your progress</span></span></button>}
          <ThemeToggle />
          {/* Signed in, you play as yourself: the shift is cast with your account's name (a guest's is made up). */}
          {account
            ? <><span>{account.name}</span><div className="avatar" style={{ width: 28, height: 28, background: me?.color, fontSize: 11 }}>{initials(account.name)}</div><button className="btn sm btn-chip" onClick={() => void account.signOut()}>Sign out</button></>
            : me && <><span>{me.name}</span><Avatar who={player} size={28} /></>}
        </div>
      </header>
      <motion.main className="onboard" variants={stagger(0.07, 0.05)} initial="hidden" animate="show">
        {/* The lesson decides who you are and where. Blank for a moment, until the lesson has loaded. */}
        <section className="hero">
          <motion.div variants={rise} className="eyebrow">WORKPLACE SIMULATOR</motion.div>
          <motion.h1 variants={rise}>{lesson.title || '\u00a0'}</motion.h1>
          <motion.p variants={rise} className="lede">{lesson.summary ?? 'You get a work computer, a real codebase and a real ticket. Colleagues message you, and what you ship decides what happens next. When it goes wrong, someone steps in and helps you put it right.'}</motion.p>
          {me && (
            <motion.div variants={rise} className="role-line">
              <div className="label">Your role</div>
              <div><b>{me.title}</b> at {company}</div>
            </motion.div>
          )}
        </section>

        <motion.section variants={rise} className="card setup">
          <div className="field">
            <div className="field-label">Where you are starting from</div>
            <Segmented id="level" grow value={level} options={LEVELS.map(k => [k, levels[k]?.label ?? ''])} onChange={v => sim.set({ level: v })} />
            <div className="level-note">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={level} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
                  {levels[level]?.blurb}
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
            {starting ? <><LoaderCircle size={17} className="spin" />Setting up your workstation</> : <>Start <ArrowRight size={17} strokeWidth={2.4} /></>}
          </button>
          {error ? <div className="cta-note bad">{error}</div> : <div className="cta-note">About 25 minutes · No score at the end</div>}
        </motion.section>
      </motion.main>
    </div>
  )
}
