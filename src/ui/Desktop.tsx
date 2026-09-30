import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimate, useMotionValue, useSpring, useTransform } from 'motion/react'
import type { MotionValue } from 'motion/react'
import { BatteryFull, Search, Wifi, X } from 'lucide-react'
import { APP_IDS, APP_NAMES, clock, shortDay } from '../../shared/types.ts'
import type { AppId, Theme } from '../../shared/types.ts'
import { live, sim, useSim, wallpaperName } from '../sim/store.ts'
import type { State } from '../sim/store.ts'
import { AppIcon, Company, LARP_LOGO, LOGOS, SPRING } from './bits.tsx'
import { Window } from './Window.tsx'
import { Mail } from './apps/Mail.tsx'
import { Chat } from './apps/Chat.tsx'
import { Code } from './apps/Code.tsx'
import { Tracker } from './apps/Tracker.tsx'
import { Monitor } from './apps/Monitor.tsx'
import { Docs } from './apps/Docs.tsx'
import { Guide } from './Guide.tsx'

const WALL: Record<string, Record<Theme, string>> = {
  Dusk: {
    light: 'radial-gradient(90% 70% at 15% 15%, #f6c7a4 0%, rgba(246,199,164,0) 60%), radial-gradient(80% 70% at 85% 25%, #c3b2ee 0%, rgba(195,178,238,0) 60%), radial-gradient(90% 80% at 60% 100%, #5b5fae 0%, rgba(91,95,174,0) 70%), linear-gradient(160deg, #e9b99f, #8a7cc0 55%, #3f4486)',
    dark: 'radial-gradient(90% 70% at 15% 15%, #6d4234 0%, rgba(109,66,52,0) 60%), radial-gradient(80% 70% at 85% 25%, #3a3070 0%, rgba(58,48,112,0) 60%), linear-gradient(160deg, #35262f, #1d1d3a 55%, #0c0d1a)',
  },
  Graphite: {
    light: 'radial-gradient(100% 80% at 30% 0%, #d2d6dd 0%, rgba(210,214,221,0) 60%), linear-gradient(170deg, #a9b1bc, #5b6470)',
    dark: 'radial-gradient(100% 80% at 30% 0%, #3a3f47 0%, rgba(58,63,71,0) 60%), linear-gradient(170deg, #24272d, #0e1013)',
  },
  Tide: {
    light: 'radial-gradient(90% 70% at 80% 10%, #c4e6e8 0%, rgba(196,230,232,0) 60%), radial-gradient(90% 80% at 10% 90%, #2f6f8f 0%, rgba(47,111,143,0) 70%), linear-gradient(165deg, #9fd0d6, #3d7fa0 55%, #1e3f5e)',
    dark: 'radial-gradient(90% 70% at 80% 10%, #1d4852 0%, rgba(29,72,82,0) 60%), linear-gradient(165deg, #15313a, #0b1a27 60%, #060c14)',
  },
}
const wallpaper = WALL[wallpaperName] ?? WALL.Dusk
const APP_VIEWS: Record<AppId, () => React.JSX.Element> = { mail: Mail, chat: Chat, code: Code, tracker: Tracker, docs: Docs, monitor: Monitor }

export function Desktop() {
  const desk = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const theme = useSim(s => s.theme)

  useLayoutEffect(() => {
    const el = desk.current!
    sim.fit(el.clientWidth, el.clientHeight)
    setReady(true)
    const ro = new ResizeObserver(() => sim.setDesk(el.clientWidth, el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="desk-host">
      <div ref={desk} className="desk" style={{ backgroundImage: wallpaper[theme] }}>
        <MenuBar />
        {ready && APP_IDS.map(id => { const View = APP_VIEWS[id]; return <Window key={id} id={id}><View /></Window> })}
        {ready && <Guide />}
        <Toasts />
        <Dock />
      </div>
    </div>
  )
}

function MenuBar() {
  const focus = useSim(s => s.focus)
  const m = useSim(s => s.simMin)
  const host = useSim(s => s.workspace.host)
  const cal = useSim(s => s.calendar)
  return (
    <motion.div className="menubar" initial={{ y: -28 }} animate={{ y: 0 }} transition={{ ...SPRING, delay: 0.15 }}>
      <Company size={15} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.b key={focus ?? 'desk'} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.12 }}>{focus ? APP_NAMES[focus] : 'Desktop'}</motion.b>
      </AnimatePresence>
      <span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span>
      <div className="grow" />
      <span className="dim">{host}</span>
      <Wifi size={14} strokeWidth={2.3} />
      <BatteryFull size={18} strokeWidth={1.9} />
      <Search size={13} strokeWidth={2.4} />
      <span className="tnum">{shortDay(cal.weekday)} {cal.date}&nbsp;&nbsp;{clock(m)}</span>
    </motion.div>
  )
}

function Toasts() {
  const toasts = useSim(s => s.toasts)
  return (
    <div className="toasts">
      <AnimatePresence mode="popLayout" initial={false}>
        {toasts.map(t => (
          <motion.div key={t.id} layout className="toast" role="status" initial={{ opacity: 0, x: 70, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 70, scale: 0.95, transition: { duration: 0.2 } }} transition={SPRING} onClick={() => { t.go(); sim.dismissToast(t.id) }}>
            {t.app ? <AppIcon app={t.app} size={32} /> : <div className="app-icon" style={{ width: 32, height: 32, borderRadius: 7.5 }}><img src={LARP_LOGO} alt="" draggable={false} /></div>}
            <div className="toast-main">
              <div className="toast-head"><span>{t.app ? APP_NAMES[t.app].toUpperCase() : 'LARP'}</span><span>now</span></div>
              <b>{t.title}</b>
              <p>{t.body}</p>
            </div>
            <button className="toast-x" aria-label="Dismiss" onClick={e => { e.stopPropagation(); sim.dismissToast(t.id) }}><X size={11} strokeWidth={3} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

const badgeOf = (s: State, id: AppId): number | string =>
  id === 'mail' ? s.emails.filter(e => !e.read && !['sent', 'deleted', 'archive'].includes(e.folder)).length
    : id === 'chat' ? Object.values(s.unread).reduce((a, b) => a + b, 0)
    : id === 'code' ? s.code.changes.length
    : id === 'monitor' && live(s) && !(s.wins.monitor.open && !s.wins.monitor.min) ? '!' : 0

function Dock() {
  const mouseX = useMotionValue(Infinity)
  // CloudWatch watches production, which a lesson with its own goal does not have.
  const goal = useSim(s => !!s.goal)
  const apps = goal ? APP_IDS.filter(id => id !== 'monitor') : APP_IDS
  return (
    <div className="dock-wrap">
      <motion.div className="dock" initial={{ y: 110, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...SPRING, delay: 0.28 }} onMouseMove={e => mouseX.set(e.clientX)} onMouseLeave={() => mouseX.set(Infinity)}>
        {apps.map(id => <DockIcon key={id} id={id} mouseX={mouseX} />)}
      </motion.div>
    </div>
  )
}

function DockIcon({ id, mouseX }: { id: AppId; mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [tile, bounce] = useAnimate<HTMLDivElement>()
  const running = useSim(s => s.wins[id].open)
  const here = useSim(s => s.focus === id)
  const badge = useSim(s => badgeOf(s, id))

  // Magnify with proximity to the cursor, like the macOS dock.
  const distance = useTransform(mouseX, x => { const b = ref.current?.getBoundingClientRect(); return b ? x - b.left - b.width / 2 : Infinity })
  const size = useSpring(useTransform(distance, [-130, 0, 130], [54, 76, 54]), { mass: 0.1, stiffness: 190, damping: 14 })
  const radius = useTransform(size, v => v * 0.235)

  const seen = useRef(badge)
  useEffect(() => {
    if (badge && badge !== seen.current) bounce(tile.current, { y: [0, -18, 0, -7, 0] }, { duration: 0.8, ease: 'easeOut' })
    seen.current = badge
  }, [badge, bounce, tile])

  return (
    <button ref={ref} className={'dock-item' + (here ? ' here' : '')} data-guide={'dock:' + id} aria-label={'Open ' + APP_NAMES[id]} onClick={() => sim.open(id)}>
      <span className="dock-tip">{APP_NAMES[id]}</span>
      <motion.div ref={tile} className="dock-tile" style={{ width: size, height: size, borderRadius: radius }}>
        <img src={LOGOS[id]} alt="" draggable={false} />
      </motion.div>
      <AnimatePresence>
        {!!badge && <motion.span key="badge" className="badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}>{badge}</motion.span>}
      </AnimatePresence>
      <i className={'dock-dot' + (running ? ' on' : '')} />
    </button>
  )
}
