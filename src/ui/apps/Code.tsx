import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Blocks, Bug, ChevronDown, ChevronRight, CircleStop, FileCode2, FileJson, FilePlus2, FileText, Files, FlaskConical, GitBranch, GitCompare, LoaderCircle, Play, Rocket, Search, Undo2, X } from 'lucide-react'
import { clock, login, shortHost } from '../../../shared/types.ts'
import { live, phone, sim, useSim } from '../../sim/store.ts'
import { EASE, LOGOS } from '../bits.tsx'
import { DragBar, Lights } from '../Window.tsx'

const Editor = lazy(() => import('./Monaco.tsx').then(m => ({ default: m.Code })))
const Compare = lazy(() => import('./Monaco.tsx').then(m => ({ default: m.Diff })))
const STATUS: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', '??': 'Untracked', R: 'Renamed' }

const icon = (path: string) => (/\.test\.ts$/.test(path) ? <FlaskConical size={13} className="ic-test" /> : /\.json$/.test(path) ? <FileJson size={13} className="ic-json" /> : /\.md$/.test(path) ? <FileText size={13} className="sub" /> : <FileCode2 size={13} className="ic-ts" />)
const name = (path: string) => path.split('/').at(-1)!

function Explorer() {
  const files = useSim(s => s.files)
  const repo = useSim(s => s.workspace.repo)
  const changes = useSim(s => s.code.changes)
  const current = useSim(s => s.codeFile)
  const [closed, setClosed] = useState<string[]>([])
  const [adding, setAdding] = useState(false)

  // Flatten the paths into rows: every folder once, then what is inside it, unless it is folded.
  const rows: { path: string; depth: number; dir: boolean }[] = []
  const seen = new Set<string>()
  for (const f of [...files].sort((a, b) => Number(!a.includes('/')) - Number(!b.includes('/')) || a.localeCompare(b))) {
    const parts = f.split('/')
    parts.slice(0, -1).forEach((_, i) => { const dir = parts.slice(0, i + 1).join('/'); if (!seen.has(dir)) { seen.add(dir); rows.push({ path: dir, depth: i, dir: true }) } })
    rows.push({ path: f, depth: parts.length - 1, dir: false })
  }
  const hidden = (p: string) => closed.some(c => p.startsWith(c + '/'))
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const path = new FormData(e.currentTarget).get('path')?.toString().trim()
    setAdding(false)
    if (path) void sim.newFile(path).catch(() => {})
  }

  return (
    <>
      <div className="explorer-head">EXPLORER<button title="New file" aria-label="New file" onClick={() => setAdding(true)}><FilePlus2 size={14} strokeWidth={1.9} /></button></div>
      <div className="explorer-root"><ChevronDown size={13} strokeWidth={2.6} />{repo.toUpperCase()}</div>
      <div className="explorer-scroll">
        {adding && <form onSubmit={add} className="tree-new"><input name="path" autoFocus placeholder="src/auth/new-file.ts" aria-label="New file path" onBlur={() => setAdding(false)} /></form>}
        {rows.filter(r => !hidden(r.path)).map(r => {
          const pad = { paddingLeft: 12 + r.depth * 13 }
          if (r.dir) {
            const folded = closed.includes(r.path)
            return <button key={r.path} className="tree-row" style={pad} onClick={() => setClosed(c => (folded ? c.filter(x => x !== r.path) : [...c, r.path]))}>{folded ? <ChevronRight size={13} strokeWidth={2.4} /> : <ChevronDown size={13} strokeWidth={2.4} />}{name(r.path)}</button>
          }
          const st = changes.find(c => c.path === r.path)?.status
          return (
            <button key={r.path} data-guide={'file:' + r.path} className={'tree-row leaf' + (current === r.path ? ' on' : '') + (st ? ' mod' : '')} style={pad} onClick={() => sim.openFile(r.path)}>
              {icon(r.path)}<span className="grow ellipsis">{name(r.path)}</span>{st && <b title={STATUS[st]}>{st === '??' ? 'U' : st}</b>}
            </button>
          )
        })}
      </div>
    </>
  )
}

function SourceControl() {
  const code = useSim(s => s.code)
  const [message, setMessage] = useState('')
  const commit = (e: FormEvent) => {
    e.preventDefault()
    if (!message.trim() || !code.changes.length) return
    void sim.commit(message.trim())
    setMessage('')
  }
  return (
    <>
      <div className="explorer-head">SOURCE CONTROL</div>
      <form className="scm" data-guide="commit" onSubmit={commit}>
        <textarea rows={2} value={message} onChange={e => setMessage(e.target.value)} placeholder={`Message (commit on ${code.branch})`} aria-label="Commit message" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(e) }} />
        <button className="btn btn-vs sm" disabled={!message.trim() || !code.changes.length || !!code.busy}>Commit</button>
      </form>
      <div className="explorer-root"><ChevronDown size={13} strokeWidth={2.6} />CHANGES<span className="tally">{code.changes.length}</span></div>
      <div className="explorer-scroll">
        {code.changes.map(c => (
          <button key={c.path} className="tree-row leaf mod" style={{ paddingLeft: 14 }} title="Compare with the last commit" onClick={() => sim.showDiff(c.path)}>
            {icon(c.path)}<span className="grow ellipsis">{name(c.path)} <span className="dim">{c.path.split('/').slice(0, -1).join('/')}</span></span><b title={STATUS[c.status]}>{c.status === '??' ? 'U' : c.status}</b>
          </button>
        ))}
        {!code.changes.length && <div className="scm-empty">No changes since the last commit.</div>}
        <div className="scm-head"><GitBranch size={12} strokeWidth={2.2} />{code.head} · {code.subject}</div>
      </div>
    </>
  )
}

function Terminal() {
  const term = useSim(s => s.term)
  const busy = useSim(s => s.code.busy)
  const prompt = useSim(s => `${s.cast[s.player] ? login(s.cast[s.player]) : 'dev'}@${shortHost(s.workspace.host)} ${s.workspace.repo} % `)
  const shown = useSim(s => s.wins.code.open && !s.wins.code.min && (s.deep.code || !phone()))
  const [line, setLine] = useState('')
  const history = useRef<string[]>([]), at = useRef(0)
  const scroller = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [term, shown, busy])

  const run = (e: FormEvent) => {
    e.preventDefault()
    if (!line.trim() || busy) return
    history.current.push(line)
    at.current = history.current.length
    void sim.exec(line)
    setLine('')
  }
  const recall = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    at.current = Math.max(0, Math.min(history.current.length, at.current + (e.key === 'ArrowUp' ? -1 : 1)))
    setLine(history.current[at.current] ?? '')
  }
  return (
    <div className="terminal" onClick={() => { if (!getSelection()?.toString()) input.current?.focus() }}>
      <div className="term-tabs"><span className="on">TERMINAL</span><span>PROBLEMS</span><span>OUTPUT</span><div className="grow" />{busy && <button className="term-stop" onClick={sim.stop}><CircleStop size={13} strokeWidth={2.2} />Stop</button>}</div>
      <div className="term-out" ref={scroller}>
        {term.map((l, i) => <div key={i} className={'tl ' + l.c}>{l.c === 'cmd' && <span className="prompt">{prompt}</span>}{l.t || ' '}</div>)}
        {busy ? <div className="tl dim"><LoaderCircle size={11} className="spin" /> running {busy}…</div> : (
          <form className="tl cmd term-line" onSubmit={run}>
            <span className="prompt">{prompt}</span>
            <input ref={input} value={line} onChange={e => setLine(e.target.value)} onKeyDown={recall} spellCheck={false} autoCapitalize="off" autoComplete="off" aria-label="Terminal input" />
          </form>
        )}
      </div>
    </div>
  )
}

export function Code() {
  const tabs = useSim(s => s.tabs)
  const file = useSim(s => s.codeFile)
  const buffer = useSim(s => s.buffers[s.codeFile])
  const buffers = useSim(s => s.buffers)
  const diff = useSim(s => s.diff)
  const side = useSim(s => s.side)
  const code = useSim(s => s.code)
  const deploys = useSim(s => s.deploys)
  const outage = useSim(s => live(s))
  const player = useSim(s => s.player)
  const repo = useSim(s => s.workspace.repo)
  const prod = deploys.at(-1)
  const dirty = (p: string) => !!buffers[p] && buffers[p].text !== buffers[p].saved
  const banner = !prod || prod.by !== player ? '' : prod.kind === 'rollback' ? `Production was rolled back to ${prod.sha} at ${clock(prod.at)}. Your change is no longer live.` : `auth-api@${prod.sha} has been live in production since ${clock(prod.at)}.`

  return (
    <div className="app code">
      <DragBar className="code-title">
        <Lights />
        <div className="code-title-text"><img src={LOGOS.code} alt="" />{file ? name(file) + ' — ' : ''}{repo}</div>
      </DragBar>
      <div className="app-body">
        <div className="activity">
          <button className={side === 'files' ? 'on' : ''} title="Explorer" aria-label="Explorer" onClick={() => sim.sidebar('files')}><Files size={20} strokeWidth={1.7} /></button>
          <button className={side === 'git' ? 'on' : ''} title="Source control" aria-label="Source control" onClick={() => sim.sidebar('git')}><GitBranch size={20} strokeWidth={1.7} />{code.changes.length > 0 && <i>{code.changes.length}</i>}</button>
          <Search size={20} strokeWidth={1.7} /><Bug size={20} strokeWidth={1.7} /><Blocks size={20} strokeWidth={1.7} />
        </div>
        <nav className="explorer">{side === 'files' ? <Explorer /> : <SourceControl />}</nav>
        <div className="editor">
          <div className="tabs">
            <div className="tab-strip">
              {tabs.map(p => (
                <div key={p} className={'tab' + (p === file && !diff ? ' on' : '')} onClick={() => sim.openFile(p)}>
                  {icon(p)}<span>{name(p)}</span>
                  <button aria-label={'Close ' + name(p)} title={dirty(p) ? 'Unsaved changes' : 'Close'} onClick={e => { e.stopPropagation(); sim.closeFile(p) }}>{dirty(p) ? <i className="unsaved" /> : <X size={12} strokeWidth={2.4} />}</button>
                </div>
              ))}
              {diff && <div className="tab on"><GitCompare size={13} className="ic-json" /><span>{name(diff.path)} (changes)</span><button aria-label="Close comparison" onClick={() => sim.set({ diff: null })}><X size={12} strokeWidth={2.4} /></button></div>}
            </div>
            <button className="btn btn-ghost sm" data-guide="run-tests" disabled={!!code.busy} onClick={() => sim.exec('npm test')}><Play size={12} strokeWidth={2.6} />Run tests</button>
            {outage
              ? <button className="btn btn-danger sm" data-guide="rollback-code" disabled={!!code.busy} onClick={() => sim.exec('ldg rollback auth-api')}><Undo2 size={13} strokeWidth={2.4} />Roll back</button>
              : <button className="btn btn-go sm" data-guide="deploy" disabled={!!code.busy} onClick={() => sim.exec('ldg deploy auth-api --env prod')}><Rocket size={13} strokeWidth={2.2} />Deploy</button>}
          </div>
          <AnimatePresence initial={false}>
            {banner && <motion.div key={banner} className={'code-banner' + (prod?.kind === 'rollback' ? ' warn' : '')} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}><div>{banner}</div></motion.div>}
          </AnimatePresence>
          {file && <div className="crumbs">{(diff?.path ?? file).replaceAll('/', '  ›  ')}{dirty(file) && !diff && <span> · unsaved, ⌘S to save</span>}</div>}
          <div className="source" data-guide="editor">
            <Suspense fallback={<div className="empty-full"><LoaderCircle size={20} className="spin" />Loading the editor</div>}>
              {diff ? <Compare path={diff.path} before={diff.head} after={buffers[diff.path]?.text ?? ''} />
                : file && buffer ? <Editor path={file} value={buffer.text} onChange={t => sim.edit(file, t)} onSave={() => void sim.save(file)} />
                : <div className="empty-full"><img src={LOGOS.code} alt="" width={56} style={{ opacity: 0.25 }} />Pick a file from the explorer</div>}
            </Suspense>
          </div>
          <Terminal />
        </div>
      </div>
      <div className="statusbar"><span><GitBranch size={12} strokeWidth={2.4} />{code.branch}</span><span>{code.head}</span><span>{code.changes.length ? `${code.changes.length} changed` : 'clean'}</span><div className="grow" /><span>prod: {prod?.sha}</span><span>TypeScript</span><span>UTF-8</span></div>
    </div>
  )
}
