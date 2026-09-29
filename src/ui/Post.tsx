// After the shift: the debrief and the shareable evidence report.
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, BadgeCheck, Check, Copy, Link2, RotateCcw } from 'lucide-react'
import { buildDebrief, buildReport, levelOf } from '../sim/debrief.ts'
import { clock } from '../sim/data.ts'
import type { Tag } from '../sim/data.ts'
import { sim, useSim } from '../sim/store.ts'
import { Avatar, Brand, CountUp, EASE, Segmented, ThemeToggle, rise, stagger } from './bits.tsx'

const TAG_HUE: Record<Tag, number> = { 'Missed signal': 70, 'Root cause': 25, Strong: 150, 'Could improve': 255 }
const DANIEL = [['1:11 PM', 'List every caller of verifySession: SSO refresh, password login, API keys.'], ['1:15 PM', 'Write a failing test: password login, then verifySession.'], ['1:20 PM', 'Read the header first, fall back to the cookie. Run the full auth suite.'], ['1:25 PM', 'Deploy to one pod, watch the 401 rate for five minutes, then roll out.'], ['If it breaks', 'Roll back within two minutes, post in #incidents, email the client, then write the postmortem.']]

export function Post() {
  const stage = useSim(s => s.stage)
  return (
    <>
      <header className="topbar">
        <Brand size={14} />
        <Segmented id="post" value={stage === 'report' ? 'report' : 'debrief'} options={[['debrief', 'Debrief'], ['report', 'Evidence report']]} onChange={v => sim.set({ stage: v })} />
        <div className="grow" />
        <ThemeToggle />
        <button className="btn btn-chip" onClick={sim.replay}><RotateCcw size={14} strokeWidth={2.4} />Replay Day 2</button>
      </header>
      <div className="page post">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stage} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.24, ease: EASE }}>
            {stage === 'report' ? <Report /> : <Debrief />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

function Debrief() {
  const d = buildDebrief(useSim(s => s))
  return (
    <motion.div className="debrief" variants={stagger(0.07)} initial="hidden" animate="show">
      <motion.div variants={rise} className="post-head">
        <div className="eyebrow">SHIFT COMPLETE · DAY 2 OF 5</div>
        <h1>Day 2 debrief</h1>
        <div className="sub">Ledgerly · Backend Developer · Tue, Sep 29 · {d.window}</div>
      </motion.div>
      <motion.div variants={rise} className="stats">
        {d.stats.map(st => <div key={st.label} className="panel stat"><span>{st.label}</span><b>{st.value}</b></div>)}
      </motion.div>
      <div className="debrief-grid">
        <motion.section variants={rise} className="panel replay">
          <div className="panel-head"><b>Decision replay</b><span>In the order they happened</span></div>
          <motion.ol variants={stagger(0.08, 0.25)}>
            {d.items.map((it, i) => (
              <motion.li key={i} variants={rise} style={{ '--hue': TAG_HUE[it.tag] } as React.CSSProperties}>
                <time>{clock(it.t)}</time>
                <i className="dot" />
                <div className="replay-body">
                  <div className="replay-title"><span className="tag">{it.tag}</span><b>{it.title}</b></div>
                  <p>{it.detail}</p>
                  {it.senior && <div className="senior"><Avatar who="daniel" size={22} /><div><b>What a senior would do: </b>{it.senior}</div></div>}
                </div>
              </motion.li>
            ))}
          </motion.ol>
        </motion.section>
        <div className="debrief-side">
          <motion.section variants={rise} className="panel">
            <b className="panel-title">Skill scores</b>
            {d.scores.map(([label, v], i) => (
              <div key={label} className="score">
                <div className="score-head"><span>{label}</span><span><em>{levelOf(v)}</em> <b><CountUp value={v} delay={0.4 + i * 0.08} /></b></span></div>
                <div className="track tall"><motion.i className={v >= 80 ? 'good' : v >= 60 ? 'accent' : 'warn'} initial={{ width: 0 }} animate={{ width: v + '%' }} transition={{ duration: 0.9, delay: 0.4 + i * 0.08, ease: EASE }} /></div>
              </div>
            ))}
          </motion.section>
          <motion.section variants={rise} className="panel">
            <b className="panel-title">Standing at Ledgerly</b>
            {d.meterDelta.map(md => (
              <div key={md.label} className="standing">
                <span>{md.label}</span>
                <span className="sub">{md.from} → {md.to}</span>
                <b className={md.d > 0 ? 'up' : md.d < 0 ? 'down' : ''}>{(md.d > 0 ? '+' : md.d < 0 ? '−' : '±') + Math.abs(md.d)}</b>
              </div>
            ))}
            <div className="sub small">This carries into Day 3. Colleagues remember.</div>
          </motion.section>
          <motion.section variants={rise} className="panel">
            <b className="panel-title">How Daniel would have run it</b>
            <dl className="plan">{DANIEL.map(([t, text]) => <div key={t}><dt>{t}</dt><dd>{text}</dd></div>)}</dl>
          </motion.section>
          <motion.button variants={rise} className="cta" onClick={() => sim.set({ stage: 'report' })}>View evidence report <ArrowRight size={16} strokeWidth={2.4} /></motion.button>
        </div>
      </div>
    </motion.div>
  )
}


function Report() {
  const r = buildReport(useSim(s => s))
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText('https://onshift.work/r/mchen-ledgerly-d2-7f3a').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <motion.div className="report" variants={stagger(0.08)} initial="hidden" animate="show">
      <motion.div variants={rise} className="panel share">
        <Link2 size={15} className="sub" />
        <span className="sub">Shareable link</span>
        <code className="grow">onshift.work/r/mchen-ledgerly-d2-7f3a</code>
        <span className="sub small">Anyone with the link</span>
        <button className="btn btn-accent sm" onClick={copy}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={String(copied)} className="swap" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }}>
              {copied ? <><Check size={13} strokeWidth={3} />Copied</> : <><Copy size={13} strokeWidth={2.4} />Copy link</>}
            </motion.span>
          </AnimatePresence>
        </button>
      </motion.div>
      <motion.article variants={rise} className="panel record">
        <div className="record-head">
          <div>
            <div className="eyebrow">VERIFIED WORK RECORD</div>
            <h1>Maya Chen</h1>
            <div className="role">Junior Backend Developer</div>
            <div className="sub">Ledgerly (simulated invoicing SaaS, 40 people) · Day 2 of 5 · Sep 29, 2026</div>
          </div>
          <div className="verified">
            <div className="pill ok big"><BadgeCheck size={15} strokeWidth={2.4} />Verified by Onshift</div>
            <code>ONS-2026-0929-7F3A</code>
          </div>
        </div>
        <section>
          <h4>SUMMARY</h4>
          <p className="summary">{r.summary}</p>
        </section>
        {r.comps.length > 0 && (
          <section>
            <h4>COMPETENCIES, WITH EVIDENCE</h4>
            <div className="comps">
              {r.comps.map(c => (
                <div key={c.name} className="comp">
                  <div className="panel-head"><b>{c.name}</b><span className="accent">{c.level}</span></div>
                  {c.ev.map((e, i) => <div key={i} className="evidence"><time>{e.time}</time><span>{e.text} <span className="sub">· {e.src}</span></span></div>)}
                </div>
              ))}
            </div>
          </section>
        )}
        {r.growth.length > 0 && (
          <section>
            <h4>GROWTH AREAS, IN MAYA’S RECORD</h4>
            {r.growth.map(g => <div key={g.title} className="growth"><b>{g.title}</b><span>{g.senior}</span></div>)}
          </section>
        )}
        <section>
          <h4>ARTIFACTS</h4>
          {r.arts.length === 0 && <div className="sub">No artifacts were produced this shift.</div>}
          {r.arts.map(a => (
            <div key={a.kind + a.id + a.title} className="artifact">
              <span className="kind">{a.kind} {a.id}</span>
              <div><b>{a.title}</b><span>{a.meta}</span></div>
              <span className="pill">{a.status}</span>
            </div>
          ))}
        </section>
        <footer>How this record was made: every action in the shift was logged ({r.events} events, {r.window}), including messages, commits, deploys and replies. Colleagues and clients are simulated; the decisions, timing and written work are Maya’s own. Scores are compared with a senior engineer’s approach to the same scenario.</footer>
      </motion.article>
    </motion.div>
  )
}
