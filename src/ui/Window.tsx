// Window chrome: position, drag, resize, and the open / close / minimise motion.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { LayoutGroup, animate, motion, useMotionValue } from 'motion/react'
import type { MotionValue } from 'motion/react'
import { ChevronLeft, Maximize2, Minus, X } from 'lucide-react'
import { APP_IDS } from '../../shared/types.ts'
import type { AppId } from '../../shared/types.ts'
import { phone, sim, useSim, winRect } from '../sim/store.ts'

type Drag = (e: ReactPointerEvent<HTMLElement>, mode?: 'move' | 'resize') => void
const Ctx = createContext<{ id: AppId; drag: Drag }>(null!)
const isControl = (t: EventTarget) => !!(t as HTMLElement).closest('button,input,textarea,select,label,a')
const GEOMETRY = { type: 'spring', stiffness: 360, damping: 36 } as const

export function Window({ id, children }: { id: AppId; children: ReactNode }) {
  const w = useSim(s => s.wins[id])
  const desk = useSim(s => s.desk)
  const focused = useSim(s => s.focus === id)
  const deep = useSim(s => s.deep[id])
  const r = winRect(w, desk)
  const left = useMotionValue(r.left), top = useMotionValue(r.top), width = useMotionValue(r.width), height = useMotionValue(r.height)

  // Hidden windows stay mounted (they keep their scroll and state) but leave the layout once their exit finishes.
  const shown = w.open && !w.min
  const shownRef = useRef(shown)
  shownRef.current = shown
  const [visible, setVisible] = useState(shown)
  if (shown && !visible) setVisible(true)

  useEffect(() => {
    // Already there (e.g. just dropped after a drag): settle without inheriting the drag's velocity.
    const glide = (v: MotionValue<number>, to: number) => (Math.abs(v.get() - to) < 0.5 ? void v.jump(to) : animate(v, to, GEOMETRY))
    const runs = [glide(left, r.left), glide(top, r.top), glide(width, r.width), glide(height, r.height)]
    return () => runs.forEach(a => a?.stop())
  }, [r.left, r.top, r.width, r.height, left, top, width, height])

  // Drag writes straight to motion values (no React work per frame) and commits to the sim on release.
  const drag: Drag = (e, mode = 'move') => {
    if (e.button !== 0 || isControl(e.target) || sim.state.wins[id].max || phone()) return
    e.preventDefault()
    const el = e.currentTarget, sx = e.clientX, sy = e.clientY
    const o = { x: left.get(), y: top.get(), w: width.get(), h: height.get() }
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      if (mode === 'resize') { width.set(Math.max(560, o.w + dx)); height.set(Math.max(360, o.h + dy)) }
      else { left.set(o.x + dx); top.set(Math.max(26, o.y + dy)) }
    }
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      sim.moveWin(id, mode === 'resize' ? { w: width.get(), h: height.get() } : { x: left.get(), y: top.get() })
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }

  // Minimising flies the window into its dock icon; the dock is centred with 64px per icon.
  const toDock = { x: desk.W / 2 + (APP_IDS.indexOf(id) - (APP_IDS.length - 1) / 2) * 64 - (r.left + r.width / 2), y: desk.H - 46 - (r.top + r.height / 2) }
  const target = shown ? { opacity: 1, scale: 1, x: 0, y: 0 } : w.min ? { opacity: 0, scale: 0.06, ...toDock } : { opacity: 0, scale: 0.95, x: 0, y: 0 }
  const transition = shown ? { type: 'spring' as const, stiffness: 380, damping: 32, mass: 0.9 }
    : w.min ? { duration: 0.44, ease: [0.5, 0, 0.2, 1] as const, opacity: { duration: 0.2, delay: 0.24 } }
    : { duration: 0.16, ease: 'easeOut' as const }

  return (
    <Ctx.Provider value={{ id, drag }}>
      <motion.div
        className={'win' + (focused ? ' focused' : '')}
        data-app={id}
        data-deep={deep || undefined}
        layoutRoot
        style={{ left, top, width, height, zIndex: w.z, display: visible ? 'block' : 'none', pointerEvents: shown ? 'auto' : 'none' }}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={target}
        transition={transition}
        onAnimationComplete={() => { if (!shownRef.current) setVisible(false) }}
        onPointerDownCapture={() => sim.focusWin(id)}
      >
        <div className="win-body"><LayoutGroup id={id}>{children}</LayoutGroup></div>
        <div className="win-resize" onPointerDown={e => { e.stopPropagation(); drag(e, 'resize') }} />
      </motion.div>
    </Ctx.Provider>
  )
}

export function Lights() {
  const { id } = useContext(Ctx)
  // A phone has no windows to manage: the lights give way to Back, from what is open to the list it came from (mobile.css).
  return (
    <>
      <button className="win-back" aria-label="Back" onClick={() => sim.dive(id, false)}><ChevronLeft size={22} strokeWidth={2.2} /></button>
      <div className="lights">
        <button className="light close" aria-label="Close window" onClick={() => sim.closeWin(id)}><X size={8} strokeWidth={3.5} /></button>
        <button className="light min" aria-label="Minimise window" onClick={() => sim.minWin(id)}><Minus size={8} strokeWidth={3.5} /></button>
        <button className="light max" aria-label="Zoom window" onClick={() => sim.maxWin(id)}><Maximize2 size={7} strokeWidth={3.5} /></button>
      </div>
    </>
  )
}

/** A strip you can grab to move the window; double-click zooms it. */
export function DragBar({ className = '', children }: { className?: string; children?: ReactNode }) {
  const { id, drag } = useContext(Ctx)
  return <div className={'dragbar ' + className} onPointerDown={drag} onDoubleClick={e => { if (!isControl(e.target)) sim.maxWin(id) }}>{children}</div>
}
