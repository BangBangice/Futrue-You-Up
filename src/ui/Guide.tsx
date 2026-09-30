// The step list in the top-left corner of the desktop, and the ring that flashes round whatever "Show me" points at.
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, ListChecks, LocateFixed } from 'lucide-react'
import { guide } from '../sim/guide.ts'
import type { Step } from '../sim/guide.ts'
import { phone, sim, useSim } from '../sim/store.ts'
import { EASE, SPRING } from './bits.tsx'

const HOLD = 4200 // how long the ring stays, in ms
const PATIENCE = 700 // how long to wait for a window to open before settling for the fallback

export function Guide() {
  const s = useSim(x => x)
  const panel = useRef<HTMLElement>(null)
  const g = guide(s), open = s.guideOpen
  const main = g.steps.filter(x => !x.side), side = g.steps.filter(x => x.side)
  const now = main.find(x => !x.done)
  const done = main.filter(x => x.done).length

  // A new phase is news, and so is being able to finish: unfold the list if it was folded away.
  const news = g.phase + (g.ready ? ':ready' : ''), phase = useRef(news)
  useEffect(() => { if (phase.current !== news) { phase.current = news; sim.set({ guideOpen: true }) } }, [news])

  return (
    <>
      <motion.aside ref={panel} className="guide" data-folded={!open || undefined} aria-label="Your steps" initial={{ y: -16, scale: 0.96 }} animate={{ y: 0, scale: 1 }} transition={{ ...SPRING, delay: 0.3 }}>
        <button className="guide-head" aria-expanded={open} onClick={() => sim.set({ guideOpen: !open })}>
          <ListChecks size={15} strokeWidth={2.2} className="accent" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.b key={g.title} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>{g.title}</motion.b>
          </AnimatePresence>
          <span className="guide-count">{done}/{main.length}</span>
          <ChevronDown size={14} strokeWidth={2.4} className={'guide-fold' + (open ? '' : ' shut')} />
        </button>
        <div className="track guide-track"><i className="accent" style={{ width: (main.length ? (done / main.length) * 100 : 0) + '%' }} /></div>
        <AnimatePresence initial={false} mode="popLayout">
          {open ? (
            <motion.div key={'list' + g.phase} className="guide-body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.24, ease: EASE }}>
              <p className="guide-sub">{g.sub}</p>
              <ol className="guide-steps">{main.map(x => <Row key={x.id} x={x} now={x === now} />)}</ol>
              {side.length > 0 && (
                <>
                  <div className="guide-label">WAITING ON YOU</div>
                  <ol className="guide-steps">{side.map(x => <Row key={x.id} x={x} now={false} />)}</ol>
                </>
              )}
            </motion.div>
          ) : now && (
            <motion.div key="next" className="guide-next" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
              <span className="ellipsis">{now.text}</span>
              <ShowMe x={now} small />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>
      <Spotlight panel={panel} />
    </>
  )
}

function Row({ x, now }: { x: Step; now: boolean }) {
  return (
    <motion.li layout="position" className={'gstep' + (x.done ? ' done' : now ? ' now' : '')} transition={SPRING}>
      <span className="gmark">
        <AnimatePresence initial={false}>{x.done && <motion.span key="tick" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}><Check size={10} strokeWidth={3.4} /></motion.span>}</AnimatePresence>
      </span>
      <div className="gtext">
        <span>{x.text}</span>
        {now && x.hint && <em>{x.hint}</em>}
        {now && <ShowMe x={x} />}
      </div>
      {!x.done && !now && <ShowMe x={x} small />}
    </motion.li>
  )
}

function ShowMe({ x, small }: { x: Step; small?: boolean }) {
  // On a phone the list covers the app it points into, so it folds out of the way.
  const show = () => { x.show(); if (phone()) sim.set({ guideOpen: false }) }
  return small
    ? <button className="gpin" title="Show me" aria-label={'Show me: ' + x.text} onClick={show}><LocateFixed size={13} strokeWidth={2.2} /></button>
    : <button className="btn btn-accent sm guide-show" onClick={show}><LocateFixed size={13} strokeWidth={2.4} />Show me</button>
}

const visible = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
const find = (key: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-guide="${CSS.escape(key)}"]`)).find(visible)
const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Scrolls the nearest scrolling list so the element is in view, without moving anything that only clips. */
function reveal(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight) continue
    const r = el.getBoundingClientRect(), box = p.getBoundingClientRect()
    if (r.top < box.top) p.scrollBy({ top: r.top - box.top - 12, behavior: 'smooth' })
    else if (r.bottom > box.bottom) p.scrollBy({ top: r.bottom - box.bottom + 12, behavior: 'smooth' })
    return
  }
}

/** Follows the target while its window opens or moves, flashes, then fades. The step list steps aside if it covers it. */
function Spotlight({ panel }: { panel: RefObject<HTMLElement | null> }) {
  const spot = useSim(s => s.spot)
  const ring = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ring.current
    if (!spot || !el) return
    const t0 = performance.now()
    let raf = 0, key = '', shown = false
    const stop = () => {
      cancelAnimationFrame(raf)
      removeEventListener('pointerdown', stop, true)
      el.classList.remove('on')
      panel.current?.removeAttribute('data-yield')
    }
    const frame = (t: number) => {
      if (t - t0 > HOLD) return stop()
      if (!key) key = spot.keys.find(k => find(k)) ?? (t - t0 > PATIENCE && spot.fallback && find(spot.fallback) ? spot.fallback : '')
      const target = key ? find(key) : undefined
      if (target) {
        if (!shown) { shown = true; reveal(target); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on') }
        const r = target.getBoundingClientRect(), pad = 4
        Object.assign(el.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px', borderRadius: (parseFloat(getComputedStyle(target).borderTopLeftRadius) || 6) + pad + 'px' })
        const p = panel.current
        if (p) p.toggleAttribute('data-yield', overlap(p.getBoundingClientRect(), r))
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    // Any click ends it: either they found it, or they are doing something else.
    addEventListener('pointerdown', stop, true)
    return stop
  }, [spot, panel])

  return createPortal(<div ref={ring} className="spot" aria-hidden />, document.body)
}
