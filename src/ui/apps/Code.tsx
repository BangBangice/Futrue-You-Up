import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Blocks, Bug, ChevronDown, FileCode2, FileJson, Files, FlaskConical, GitBranch, LoaderCircle, Play, Rocket, Search, Undo2, Wrench } from 'lucide-react'
import { CODE, FILES, clock } from '../../sim/data.ts'
import type { FileId } from '../../sim/data.ts'
import { sim, useSim } from '../../sim/store.ts'
import { EASE, LOGOS } from '../bits.tsx'
import { DragBar, Lights } from '../Window.tsx'

type Node = { file?: FileId; label?: string; depth: number; dir?: boolean }
const TREE: Node[] = [{ label: 'src', depth: 0, dir: true }, { label: 'auth', depth: 1, dir: true }, { file: 'vs', depth: 2 }, { file: 'pw', depth: 2 }, { file: 'key', depth: 2 }, { file: 'test', depth: 2 }, { label: 'sso', depth: 1, dir: true }, { file: 'sso', depth: 2 }, { label: 'package.json', depth: 0 }]

// ponytail: regex colouring, good for the sim's fixed snippets only. Swap for Shiki if players ever edit code.
const TOKENS = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|export|from|type|const|let|async|await|function|return|if|else|describe|it|expect)\b|\b(true|false|null|undefined|\d+)\b|([A-Za-z_]\w*)(?=\()/g
const KINDS = ['', 'c', 's', 'k', 'n', 'f']
function highlight(text: string) {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(TOKENS)) {
    if (m.index > at) out.push(text.slice(at, m.index))
    out.push(<span key={m.index} className={'t-' + KINDS[m.findIndex((g, i) => i > 0 && g !== undefined)]}>{m[0]}</span>)
    at = m.index + m[0].length
  }
  out.push(text.slice(at))
  return out
}

export function Code() {
  const file = useSim(s => s.codeFile)
  const stage = useSim(s => s.codeStage)
  const phase = useSim(s => s.phase)
  const term = useSim(s => s.term)
  const testsBusy = useSim(s => s.testsBusy)
  const deployBusy = useSim(s => s.deployBusy)
  const deployedAt = useSim(s => s.f.deploy)
  const shown = useSim(s => s.wins.code.open && !s.wins.code.min)

  const version = stage === 'reverted' || stage === 'patched' ? stage : 'draft'
  const src = file === 'vs' ? CODE[`vs_${version}`] : CODE[file]
  const modified = stage === 'draft' || stage === 'patched'
  const banner = { draft: '', deployed: 'Deployed a41f9c2 to prod at ' + clock(deployedAt ?? 0), reverted: 'Rolled back to 7c19e02. Your LED-214 change is no longer in prod.', patched: phase === 'resolved' ? 'Deployed c83d1b7 (cookie fallback) to prod' : 'Deploying c83d1b7: cookie fallback' }[stage]
  const status = { draft: '1 file changed', deployed: 'deployed a41f9c2', reverted: 'rolled back · 7c19e02', patched: 'c83d1b7' }[stage]

  const termEl = useRef<HTMLDivElement>(null)
  useEffect(() => { termEl.current?.scrollTo({ top: termEl.current.scrollHeight, behavior: 'smooth' }) }, [term, shown, testsBusy, deployBusy])

  let n = 0
  return (
    <div className="app code">
      <DragBar className="code-title">
        <Lights />
        <div className="code-title-text"><img src={LOGOS.code} alt="" />{FILES[file].name} — ledgerly-api</div>
      </DragBar>
      <div className="app-body">
        <div className="activity"><Files size={20} className="on" /><Search size={20} /><GitBranch size={20} /><Bug size={20} /><Blocks size={20} /></div>
        <nav className="explorer">
          <div className="explorer-head">EXPLORER</div>
          <div className="explorer-root"><ChevronDown size={13} strokeWidth={2.6} />LEDGERLY-API</div>
          {TREE.map((node, i) => {
            const pad = { paddingLeft: 14 + node.depth * 13 }
            if (!node.file) return <div key={i} className="tree-row" style={pad}>{node.dir ? <ChevronDown size={13} strokeWidth={2.4} /> : <FileJson size={13} className="ic-json" />}{node.label}</div>
            const f = node.file, mod = f === 'vs' && modified
            const Icon = f === 'test' ? FlaskConical : FileCode2
            return (
              <button key={i} className={'tree-row leaf' + (file === f ? ' on' : '') + (mod ? ' mod' : '')} style={pad} onClick={() => sim.pickFile(f)}>
                <Icon size={13} className={f === 'test' ? 'ic-test' : 'ic-ts'} /><span className="grow ellipsis">{FILES[f].name}</span>{mod && <b>M</b>}
              </button>
            )
          })}
        </nav>
        <div className="editor">
          <div className="tabs">
            <div className="tab"><FileCode2 size={13} className="ic-ts" />{FILES[file].name}{file === 'vs' && stage !== 'reverted' && <span className="tab-diff">diff</span>}</div>
            <div className="grow" />
            {stage === 'draft' && (
              <>
                <button className="btn btn-ghost sm" disabled={testsBusy || deployBusy} onClick={sim.runTests}>{testsBusy ? <LoaderCircle size={13} className="spin" /> : <Play size={12} strokeWidth={2.6} />}{testsBusy ? 'Running…' : 'Run tests'}</button>
                <button className="btn btn-go sm" disabled={testsBusy || deployBusy} onClick={sim.deploy}>{deployBusy ? <LoaderCircle size={13} className="spin" /> : <Rocket size={13} strokeWidth={2.2} />}{deployBusy ? 'Deploying…' : 'Commit & deploy'}</button>
              </>
            )}
            {phase === 'incident' && (
              <>
                <button className="btn btn-danger sm" onClick={sim.revert}><Undo2 size={13} strokeWidth={2.4} />Revert deploy</button>
                <button className="btn btn-ghost sm" onClick={sim.patch}><Wrench size={13} strokeWidth={2.2} />Patch forward</button>
              </>
            )}
          </div>
          <AnimatePresence initial={false}>
            {banner && <motion.div key={banner} className="code-banner" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}><div>{banner}</div></motion.div>}
          </AnimatePresence>
          <div className="crumbs">{FILES[file].path.replaceAll('/', '  ›  ')}</div>
          <motion.div key={file + version} className="source" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}>
            {src.map((line, i) => {
              const sign = line[0]
              if (sign !== '-') n++
              return (
                <div key={i} className={'line' + (sign === '+' ? ' add' : sign === '-' ? ' del' : '')}>
                  <span className="ln">{sign === '-' ? '' : n}</span><span className="sign">{sign.trim()}</span><span className="src">{highlight(line.slice(1))}</span>
                </div>
              )
            })}
          </motion.div>
          <div className="terminal">
            <div className="term-tabs"><span className="on">TERMINAL</span><span>PROBLEMS</span><span>OUTPUT</span></div>
            <div className="term-out" ref={termEl}>
              {term.map((l, i) => (
                <motion.div key={i} className={'tl ' + l.c} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
                  {l.c === 'cmd' && <span className="prompt">maya@ws-02 ledgerly-api % </span>}{l.t}
                </motion.div>
              ))}
              {!testsBusy && !deployBusy && <div className="tl cmd"><span className="prompt">maya@ws-02 ledgerly-api % </span><i className="caret" /></div>}
            </div>
          </div>
        </div>
      </div>
      <div className="statusbar"><span><GitBranch size={12} strokeWidth={2.4} />{stage === 'draft' ? 'maya/led-214-sso-expiry' : 'main'}</span><span>{status}</span><div className="grow" /><span>TypeScript</span><span>UTF-8</span></div>
    </div>
  )
}
