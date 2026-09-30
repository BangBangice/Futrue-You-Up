// After the shift: what happened, what you put right, and what to practise next. No score.
import { motion } from 'motion/react'
import { ArrowLeft, Check, CircleAlert, Footprints, LoaderCircle, RotateCcw } from 'lucide-react'
import { Link } from 'react-router'
import { clock, shortDay } from '../../shared/types.ts'
import { sim, useSim } from '../sim/store.ts'
import { Avatar, Brand, ThemeToggle, rise, stagger } from './bits.tsx'

export function Post() {
  const recap = useSim(s => s.recap)
  const end = useSim(s => s.simMin)
  const company = useSim(s => s.company), lesson = useSim(s => s.lesson), role = useSim(s => s.cast[s.player]?.title)
  const cal = useSim(s => s.calendar)
  const mentorId = useSim(s => s.mentor), mentor = useSim(s => s.cast[s.mentor])
  if (!recap) return null
  return (
    <>
      <header className="topbar">
        <Brand size={14} home />
        <div className="grow" />
        <ThemeToggle />
        {/* Leaving clears the finished shift, as Do it again does, so the next visit to /play is a fresh start page. */}
        <Link className="btn btn-ink" to="/" onClick={sim.replay}><ArrowLeft size={14} strokeWidth={2.4} />Back to the library</Link>
      </header>
      <div className="page">
        <motion.div className="recap" variants={stagger(0.08)} initial="hidden" animate="show">
          <motion.div variants={rise} className="post-head">
            <div className="eyebrow">SHIFT COMPLETE</div>
            <h1>What today was for</h1>
            <div className="sub">{lesson.title} · {role}, {company} · {shortDay(cal.weekday)}, {cal.date} · {clock(cal.start)} – {clock(end)}</div>
          </motion.div>

          {/* The author playing their own lesson is testing it: whether this shift counts towards publishing, and the way back. */}
          {lesson.mine && (
            <motion.section variants={rise} className={'panel author-test' + (recap.finished ? ' good' : '')}>
              {recap.finished ? <Check size={18} strokeWidth={2.6} /> : <CircleAlert size={18} strokeWidth={2.2} />}
              <span>{recap.finished ? 'This test counted: you have finished a shift on this version of your lesson.' : "This test didn't count: ship the fix so every check passes, then end the shift."}</span>
              <Link className="btn btn-soft" to={`/my/lessons/${lesson.id}`} onClick={sim.replay}><ArrowLeft size={14} strokeWidth={2.4} />Back to your lesson</Link>
            </motion.section>
          )}

          <motion.section variants={rise} className="panel mentor-note">
            <Avatar who={mentorId} size={40} />
            <div>
              <div className="comment-head"><b>{mentor.name}</b><span className="sub small">{mentor.title} · your mentor</span></div>
              {recap.ready ? recap.note.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>) : <p className="sub writing"><LoaderCircle size={14} className="spin" />{mentor.name.split(' ')[0]} is writing to you. What happened today is below in the meantime.</p>}
            </div>
          </motion.section>

          <div className="recap-grid">
            <motion.section variants={rise} className="panel">
              <b className="panel-title">What happened</b>
              <ol className="happened">
                {recap.happened.map((line, i) => <li key={i}><time>{line.slice(0, line.indexOf('  '))}</time><i /><span>{line.slice(line.indexOf('  ') + 2)}</span></li>)}
                {!recap.happened.length && <li><span className="sub">Nothing was shipped this shift.</span></li>}
              </ol>
            </motion.section>
            <div className="recap-side">
              {recap.corrected.length > 0 && (
                <motion.section variants={rise} className="panel">
                  <b className="panel-title">What you put right</b>
                  {recap.corrected.map((c, i) => <div key={i} className="recap-item good"><Check size={15} strokeWidth={2.6} /><span>{c}</span></div>)}
                </motion.section>
              )}
              {recap.ready && (
                <motion.section variants={rise} className="panel">
                  <b className="panel-title">Practise on your next ticket</b>
                  {recap.next.map((c, i) => <div key={i} className="recap-item"><Footprints size={15} strokeWidth={2} /><span>{c}</span></div>)}
                </motion.section>
              )}
              <motion.button variants={rise} className="cta" onClick={sim.replay}><RotateCcw size={16} strokeWidth={2.4} />Do it again</motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  )
}
