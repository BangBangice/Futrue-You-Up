// The editor itself. Loaded on demand because Monaco is large, and bundled locally so it works without internet.
import { useRef } from 'react'
import { DiffEditor, Editor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'
import { phone } from '../../sim/store.ts'

self.MonacoEnvironment = { getWorker: (_, label) => (label === 'typescript' || label === 'javascript' ? new TsWorker() : label === 'json' ? new JsonWorker() : new EditorWorker()) }
loader.config({ monaco })
// The workspace runs on Node with no type packages installed. Flag syntax errors, not missing types.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
monaco.editor.defineTheme('larp', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#1e2028', 'editorGutter.background': '#1e2028', 'diffEditor.insertedTextBackground': '#2ea04333', 'diffEditor.removedTextBackground': '#f8514933' } })

const LANG: Record<string, string> = { ts: 'typescript', js: 'javascript', json: 'json', md: 'markdown' }
const language = (path: string) => LANG[path.split('.').at(-1)!] ?? 'plaintext'
const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 20, minimap: { enabled: false }, scrollBeyondLastLine: false,
  renderLineHighlight: 'line', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', padding: { top: 8 }, automaticLayout: true, tabSize: 2, stickyScroll: { enabled: false },
  // A phone is too narrow to scroll code sideways or to spend width on the gutter.
  ...(phone() ? { wordWrap: 'on', wrappingIndent: 'indent', lineNumbersMinChars: 2, folding: false, glyphMargin: false, lineDecorationsWidth: 6 } : {}),
}

export function Code({ path, value, onChange, onSave }: { path: string; value: string; onChange: (text: string) => void; onSave: () => void }) {
  const save = useRef(onSave)
  save.current = onSave
  return (
    <Editor
      theme="larp" path={path} language={language(path)} value={value} options={OPTIONS}
      onChange={v => onChange(v ?? '')}
      onMount={editor => editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save.current())}
    />
  )
}

export function Diff({ path, before, after }: { path: string; before: string; after: string }) {
  return <DiffEditor keepCurrentOriginalModel keepCurrentModifiedModel theme="larp" language={language(path)} original={before} modified={after} options={{ ...OPTIONS, readOnly: true, renderSideBySide: true, originalEditable: false }} />
}
