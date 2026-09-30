// Small shared pieces: brand mark, avatars, app icons, segmented control, theme toggle.
import { useEffect, useRef } from 'react'
import { animate, motion } from 'motion/react'
import { Moon, Sun } from 'lucide-react'
import { Link } from 'react-router'
import type { AppId, PersonId } from '../../shared/types.ts'
import { setTheme, useSim } from '../sim/store.ts'
import outlook from '../assets/logos/outlook.png'
import teams from '../assets/logos/teams.png'
import vscode from '../assets/logos/vscode.png'
import jira from '../assets/logos/jira.svg'
import aws from '../assets/logos/aws.png'
import confluence from '../assets/logos/confluence.png'
import larpBlack from '../assets/logos/larp-black.png'
import larpWhite from '../assets/logos/larp-white.png'

export const LARP_LOGO = larpBlack
export const LOGOS: Record<AppId, string> = { mail: outlook, chat: teams, code: vscode, tracker: jira, docs: confluence, monitor: aws }
export const SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const
export const EASE = [0.2, 0.8, 0.2, 1] as const
/** Staggered fade-up for page sections. */
export const rise = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
}
export const stagger = (gap = 0.06, delay = 0) => ({ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } })

/** With `home`, the mark links back to the library. */
export function Brand({ size = 15, home }: { size?: number; home?: boolean }) {
  const theme = useSim(s => s.theme)
  const mark = <>
    <img className="brand-logo" src={theme === 'dark' ? larpWhite : larpBlack} alt="" draggable={false} />
    <span style={{ fontSize: size }}>LARP</span>
  </>
  return home ? <Link to="/" className="brand" title="Lesson library">{mark}</Link> : <div className="brand">{mark}</div>
}

export function Avatar({ who, size = 32 }: { who: PersonId; size?: number }) {
  const p = useSim(s => s.cast[who])
  if (who === 'cloudwatch' || who === 'jira') return <div className="avatar avatar-app" style={{ width: size, height: size }}><img src={who === 'jira' ? jira : aws} alt="" draggable={false} /></div>
  return <div className="avatar" style={{ width: size, height: size, background: p.color, fontSize: Math.round(size * 0.38) }}>{p.init}</div>
}

export function AppIcon({ app, size = 30 }: { app: AppId; size?: number }) {
  return <div className="app-icon" style={{ width: size, height: size, borderRadius: size * 0.235 }}><img src={LOGOS[app]} alt="" draggable={false} /></div>
}

export function Company({ size = 22 }: { size?: number }) {
  const initial = useSim(s => s.company.slice(0, 1).toUpperCase())
  return <div className="company" style={{ width: size, height: size, borderRadius: size * 0.27, fontSize: size * 0.5 }}>{initial}</div>
}

export function Segmented<T extends string>({ id, value, options, onChange, grow }: { id: string; value: T; options: [T, string][]; onChange: (v: T) => void; grow?: boolean }) {
  return (
    <div className={'seg' + (grow ? ' seg-grow' : '')} role="tablist">
      {options.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={k === value} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>
          {k === value && <motion.span layoutId={'seg-' + id} className="seg-pill" transition={SPRING} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

export function ThemeToggle() {
  const theme = useSim(s => s.theme)
  const Icon = theme === 'light' ? Moon : Sun
  return (
    <button className="icon-btn" title={theme === 'light' ? 'Switch to dark' : 'Switch to light'} aria-label="Toggle theme" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      <motion.span key={theme} initial={{ rotate: -60, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} transition={SPRING} style={{ display: 'grid' }}>
        <Icon size={16} strokeWidth={2.2} />
      </motion.span>
    </button>
  )
}

/** A number that eases to its new value instead of jumping. */
export function CountUp({ value, delay = 0 }: { value: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(0)
  useEffect(() => {
    const c = animate(from.current, value, { duration: 0.9, delay, ease: EASE, onUpdate: v => { if (ref.current) ref.current.textContent = String(Math.round(v)) } })
    from.current = value
    return () => c.stop()
  }, [value, delay])
  return <span ref={ref}>0</span>
}
