// A textarea that suggests how the text goes on, greyed out after the caret, like an editor's inline completion. Tab takes it (on a
// phone, tapping the badge), Esc drops it, and typing what it says keeps the rest. A mirror behind the transparent textarea draws the
// text and the suggestion.
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, TextareaHTMLAttributes } from 'react'
import { LoaderCircle } from 'lucide-react'

/** After a pause this long in typing, ask. */
const PAUSE_MS = 600
const MIN_TEXT = 12
/** When the server says to ask again (the model was busy), wait this long, at most this many times. */
const RETRY_MS = 2500, RETRIES = 2

/** What is left of the suggestion once the text changes from `before` to `after`: the rest of it if they typed its start, else nothing. */
export function advance(hint: string, before: string, after: string): string {
  if (!hint || !after.startsWith(before)) return ''
  const typed = after.slice(before.length)
  return hint.startsWith(typed) ? hint.slice(typed.length) : ''
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (v: string) => void
  /** The continuation of the text, '' for none, or null for none yet: worth asking again in a moment. May reject; that counts as none. */
  suggest: (text: string, signal: AbortSignal) => Promise<string | null>
}
export function SuggestingTextarea({ value, onChange, suggest, disabled, className = '', onKeyDown, ...rest }: Props) {
  const [hint, setHint] = useState('')
  const [atEnd, setAtEnd] = useState(true)
  // Asked and waiting, so the author can see a suggestion is on its way rather than wonder whether any will come.
  const [pending, setPending] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null), mirror = useRef<HTMLDivElement>(null)
  // Suggestions already fetched, so deleting and retyping doesn't ask again. And the text a suggestion was made for.
  const seen = useRef(new Map<string, string>()), shown = useRef('')
  const suggestRef = useRef(suggest)
  suggestRef.current = suggest

  useEffect(() => {
    if (hint || disabled || !atEnd || value.trim().length < MIN_TEXT) return
    const known = seen.current.get(value)
    if (known !== undefined) { shown.current = value; setHint(known); return }
    const ctl = new AbortController()
    let wait: ReturnType<typeof setTimeout>
    const ask = (tries: number) => {
      setPending(true)
      suggestRef.current(value, ctl.signal).then(s => {
        if (ctl.signal.aborted) return
        // None yet is not remembered: the same text is asked about again, now and after a later edit.
        if (s === null) { if (tries < RETRIES) wait = setTimeout(() => ask(tries + 1), RETRY_MS); else setPending(false); return }
        seen.current.set(value, s)
        setPending(false)
        shown.current = value
        setHint(s)
      }, () => { if (!ctl.signal.aborted) setPending(false) })
    }
    wait = setTimeout(() => ask(0), PAUSE_MS)
    return () => { clearTimeout(wait); ctl.abort(); setPending(false) }
  }, [value, hint, disabled, atEnd])

  // Keep the mirror scrolled with the textarea.
  const sync = () => { if (mirror.current && area.current) mirror.current.scrollTop = area.current.scrollTop }
  useEffect(sync, [value, hint])

  const caret = () => { const a = area.current; setAtEnd(!!a && a.selectionStart === a.selectionEnd && a.selectionEnd === a.value.length) }
  const change = (next: string) => {
    const rest = advance(hint, shown.current, next)
    shown.current = next
    setHint(rest)
    onChange(next)
  }
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const visible = hint && atEnd && !disabled
    if (visible && e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      change(value + hint)
    } else if (visible && e.key === 'Escape') {
      e.preventDefault()
      seen.current.set(value, '')
      setHint('')
    }
    onKeyDown?.(e)
  }
  const visible = !!hint && atEnd && !disabled
  return (
    <div className="suggesting">
      <div ref={mirror} className={`input suggest-mirror ${className}`} aria-hidden="true">
        {value}{visible && <span className="suggest-hint">{hint}</span>}
      </div>
      <textarea ref={area} className={`input ${className}`} value={value} disabled={disabled} {...rest}
        onChange={e => change(e.target.value)} onKeyDown={key} onSelect={caret} onScroll={sync} onBlur={() => setAtEnd(false)} onFocus={caret} />
      {pending && !visible && atEnd && !disabled && <span className="suggest-key suggest-wait sub" aria-hidden="true"><LoaderCircle size={11} className="spin" />Thinking</span>}
      {visible && (
        <button type="button" className="suggest-key sub" aria-live="polite" onMouseDown={e => e.preventDefault()} onClick={() => change(value + hint)}>
          <span className="on-key"><kbd>Tab</kbd> to accept</span><span className="on-touch">Tap to accept</span><span className="sr-only">: {hint}</span>
        </button>
      )}
    </div>
  )
}
