// The only module that touches the disk or starts a process on the player's behalf.
// Everything the player types or saves goes through the guards here.
//
// ponytail: guard rails for a laptop demo, not a security boundary. Player code runs as the local user
// with file reads fenced to the workspace and the network blocked on macOS. To host this publicly,
// replace spawn() below with a container (no network, read-only root, non-root user). Nothing else changes.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Check, CodeState, GitFile, TermLine } from '../shared/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, '..', 'workspace-template', 'ledgerly-api')
const ACCEPTANCE = join(HERE, 'acceptance.ts')
const NODE = process.execPath
const SEATBELT = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') ? ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)'] : []
const MAX_FILE = 200_000, MAX_FILES = 200, MAX_OUTPUT = 64_000
export const FAKE_HOME = '/Users/maya/ledgerly-api'

/** Thrown for anything the player may not do. The message is shown to them, so it should help. */
export class Refusal extends Error {}
export type Emit = (line: TermLine) => void
export interface Verdict { build: 'ok' | 'broken'; error?: string; checks: Check[] }

const GIT_SUBCOMMANDS = ['status', 'diff', 'log', 'show', 'add', 'commit', 'restore', 'checkout', 'switch', 'branch', 'stash', 'reset', 'revert', 'rm', 'mv', 'blame']
const GIT_FLAGS = /^(-[0-9]+|-m|-a|-am|-p|-A|-b|-B|-d|-D|-s|-sb|-u|-v|-q|-f|-r|-n|--|--staged|--cached|--stat|--oneline|--graph|--all|--amend|--no-edit|--hard|--soft|--mixed|--name-only|--name-status|--short|--branch|--patch|--decorate|--abbrev-commit|--force|--theirs|--ours|--worktree|--source|--include-untracked|--max-count=\d+|--(pretty|format)=[\w%:() ,.'-]+)$/
const HELP = [
  'Available on this workstation:',
  '  ls, cat, cd, pwd, touch, mkdir, rm, clear',
  '  git status | diff | log | show | add | commit | restore | checkout | switch | branch | stash | reset | revert | blame',
  '  npm test [-- path]        run the tests, all or one area',
  '  ldg status                what is live in production',
  '  ldg deploy auth-api --env prod',
  '  ldg rollback auth-api     put the previous release back',
  'Pipes, redirects and variables are not supported here.',
]

/** Splits a command line into arguments the way a shell would, without being one. */
export function tokenize(cmd: string): string[] {
  const out: string[] = []
  let cur = '', quote = '', open = false
  for (const ch of cmd) {
    if (quote) { if (ch === quote) quote = ''; else cur += ch; continue }
    if (ch === '"' || ch === "'") { quote = ch; open = true; continue }
    if (/\s/.test(ch)) { if (cur || open) out.push(cur); cur = ''; open = false; continue }
    if ('|&;<>$`()'.includes(ch)) throw new Refusal(`"${ch}" is not supported in this terminal. Run one command at a time, without pipes, redirects or variables.`)
    cur += ch
  }
  if (quote) throw new Refusal('That command has an unclosed quote.')
  if (cur || open) out.push(cur)
  return out
}

export class Workspace {
  /** Where the player "is", relative to the root. */
  cwd = ''
  private running: ReturnType<typeof spawn> | null = null
  readonly root: string
  private readonly home: string
  private constructor(root: string, home: string) { this.root = root; this.home = home }

  static async open(dir: string) {
    const root = join(dir, 'workspace')
    const fresh = !existsSync(join(root, '.git'))
    if (fresh) {
      await rm(root, { recursive: true, force: true })
      await cp(TEMPLATE, root, { recursive: true })
    }
    const ws = new Workspace(await realpath(root), await realpath(dir))
    if (fresh) {
      const past = { GIT_AUTHOR_NAME: 'Daniel Okafor', GIT_AUTHOR_EMAIL: 'daniel@ledgerly.io', GIT_COMMITTER_NAME: 'Daniel Okafor', GIT_COMMITTER_EMAIL: 'daniel@ledgerly.io', GIT_AUTHOR_DATE: '2026-09-22T16:40:00', GIT_COMMITTER_DATE: '2026-09-22T16:40:00' }
      await ws.git(['init', '-q', '-b', 'main'])
      await ws.git(['add', '-A'])
      await ws.git(['commit', '-q', '-m', 'chore(session): move session store to Redis 7 (LED-205)'], past)
      await ws.git(['checkout', '-q', '-b', 'maya/led-214-sso-expiry'])
    }
    return ws
  }

  // ---------- paths ----------
  /** Resolves a player-supplied path, or refuses it. Nothing outside the workspace, nothing inside .git. */
  inside(rel: string, from = ''): string {
    if (typeof rel !== 'string' || rel.includes('\0') || isAbsolute(rel)) throw new Refusal(`${rel}: paths must be relative to the project`)
    const p = resolve(this.root, from, rel)
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Refusal(`${rel}: that is outside the project`)
    if (relative(this.root, p).split(sep).some(s => s === '.git' || s === 'node_modules')) throw new Refusal(`${rel}: that folder is managed for you`)
    return p
  }
  /** As inside(), and also refuses symlinks, which could point anywhere. */
  private async real(rel: string, from = '') {
    const p = this.inside(rel, from)
    const info = await lstat(p).catch(() => null)
    if (info?.isSymbolicLink()) throw new Refusal(`${rel}: links are not supported`)
    return { p, info }
  }
  private rel = (p: string) => relative(this.root, p).split(sep).join('/')

  async tree(): Promise<string[]> {
    const all = await readdir(this.root, { recursive: true, withFileTypes: true })
    return all.filter(e => e.isFile()).map(e => this.rel(join(e.parentPath, e.name))).filter(p => !/^(\.git|node_modules)(\/|$)/.test(p)).sort()
  }
  async read(rel: string, rev?: string): Promise<string> {
    if (rev) {
      const { code, out } = await this.git(['show', `HEAD:${this.rel(this.inside(rel))}`])
      return code === 0 ? out : ''
    }
    const { p, info } = await this.real(rel)
    if (!info?.isFile()) throw new Refusal(`${rel}: no such file`)
    if (info.size > MAX_FILE) throw new Refusal(`${rel}: too large to open here`)
    return readFile(p, 'utf8')
  }
  async write(rel: string, text: string) {
    if (typeof text !== 'string' || text.length > MAX_FILE) throw new Refusal(`${rel}: files are limited to ${MAX_FILE / 1000} KB`)
    const { p, info } = await this.real(rel)
    if (info?.isDirectory()) throw new Refusal(`${rel}: that is a folder`)
    if (!info && (await this.tree()).length >= MAX_FILES) throw new Refusal('This project has reached its file limit.')
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, text)
  }

  // ---------- processes ----------
  private run(bin: string, argv: string[], opts: { env?: Record<string, string>; emit?: Emit; timeout?: number; cwd?: string } = {}) {
    return new Promise<{ code: number; out: string }>(done => {
      const child = spawn(bin, argv, {
        cwd: opts.cwd ?? this.root, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
        // Never the server's own environment: that is where the API key lives.
        env: { PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: this.home, TMPDIR: this.home, LANG: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', ...opts.env },
      })
      this.running = child
      let out = '', tail = '', killed = ''
      const stop = (why: string) => { if (!killed) { killed = why; try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } } }
      const timer = setTimeout(() => stop(`Stopped after ${(opts.timeout ?? 15_000) / 1000} seconds.`), opts.timeout ?? 15_000)
      const take = (chunk: Buffer) => {
        const text = chunk.toString()
        out += text
        if (out.length > MAX_OUTPUT) return stop('Output was cut off: too much to show.')
        const lines = (tail + text).split('\n')
        tail = lines.pop()!
        lines.forEach(l => opts.emit?.(tone(l)))
      }
      child.stdout!.on('data', take)
      child.stderr!.on('data', take)
      child.on('error', e => { clearTimeout(timer); done({ code: 127, out: String(e.message) }) })
      child.on('close', code => {
        clearTimeout(timer)
        this.running = null
        if (tail) opts.emit?.(tone(tail))
        if (killed) opts.emit?.({ c: 'err', t: killed })
        done({ code: killed ? 137 : code ?? 1, out })
      })
    })
  }
  kill() { if (this.running?.pid) try { process.kill(-this.running.pid, 'SIGKILL') } catch { /* already gone */ } }
  get busy() { return !!this.running }

  /** Git, pinned to this workspace so it can never walk up into the repository that hosts the simulator. */
  git(args: string[], env: Record<string, string> = {}, emit?: Emit, cwd?: string) {
    return this.run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '-c', 'core.pager=cat', '-c', 'advice.detachedHead=false', ...args], {
      emit, cwd,
      env: {
        GIT_DIR: join(this.root, '.git'), GIT_WORK_TREE: this.root, GIT_CEILING_DIRECTORIES: dirname(this.root),
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_EDITOR: 'true', GIT_OPTIONAL_LOCKS: '0',
        GIT_AUTHOR_NAME: 'Maya Chen', GIT_AUTHOR_EMAIL: 'maya.chen@ledgerly.io', GIT_COMMITTER_NAME: 'Maya Chen', GIT_COMMITTER_EMAIL: 'maya.chen@ledgerly.io', ...env,
      },
    })
  }
  /** Player code. No file writes, no child processes, no network, reads fenced to the workspace. */
  private node(args: string[], reads: string[], emit?: Emit, timeout = 20_000) {
    const argv = [NODE, '--no-warnings', '--permission', ...reads.map(r => `--allow-fs-read=${r}`), '--experimental-strip-types', '--max-old-space-size=256', ...args]
    const [bin, ...rest] = [...SEATBELT, ...argv]
    return this.run(bin, rest, { emit, timeout, env: { NODE_OPTIONS: '' } })
  }

  async state(): Promise<CodeState> {
    const [branch, head, status] = await Promise.all([this.git(['rev-parse', '--abbrev-ref', 'HEAD']), this.git(['log', '-1', '--format=%h%x09%s']), this.git(['status', '--porcelain'])])
    const [sha, subject] = head.out.trim().split('\t')
    const changes: GitFile[] = status.out.split('\n').filter(Boolean).map(l => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }))
    return { branch: branch.out.trim(), head: sha, subject, changes, busy: null }
  }
  async commit(message: string) {
    await this.git(['add', '-A'])
    return this.git(['commit', '-m', message])
  }

  async test(paths: string[], emit: Emit) {
    const files = new Set<string>()
    for (const given of paths.length ? paths : ['.']) {
      const { p, info } = await this.real(given, this.cwd)
      if (!info) throw new Refusal(`${given}: no such file or folder`)
      if (info.isFile()) files.add(p)
      else for (const e of await readdir(p, { recursive: true, withFileTypes: true })) if (e.isFile() && /\.test\.ts$/.test(e.name) && !e.parentPath.includes('node_modules')) files.add(join(e.parentPath, e.name))
    }
    if (!files.size) { emit({ c: 'err', t: 'No test files found.' }); return 1 }
    const { code } = await this.node(['--test', '--experimental-test-isolation=none', '--test-reporter=spec', ...[...files].sort().map(this.rel)], [this.root], emit)
    return code
  }

  /** Runs the hidden production checks against whatever is in the working tree. */
  async accept(): Promise<Verdict> {
    const { out } = await this.node([ACCEPTANCE, this.root], [this.root, ACCEPTANCE], undefined, 12_000)
    const line = out.split('\n').findLast(l => l.startsWith('@@CHECKS@@'))
    if (line) return JSON.parse(line.slice(10))
    return { build: 'broken', error: out.split('\n').find(l => /Error|error/.test(l))?.trim().slice(0, 300) ?? 'the service did not start', checks: [] }
  }

  /**
   * Runs one line typed into the terminal. Returns the exit code.
   * `ldg` is not handled here: it changes production, which belongs to the director.
   */
  async exec(argv: string[], emit: Emit): Promise<number> {
    const [cmd, ...args] = argv
    const say = (t: string, c: TermLine['c'] = 'out') => emit({ c, t })
    const at = (p = '.') => this.real(p, this.cwd)

    switch (cmd) {
      case 'help': HELP.forEach(l => say(l, 'dim')); return 0
      case 'pwd': say(FAKE_HOME + (this.cwd ? '/' + this.cwd : '')); return 0
      case 'cd': {
        const { p, info } = args[0] && args[0] !== '~' ? await at(args[0]) : { p: this.root, info: await stat(this.root) }
        if (!info?.isDirectory()) throw new Refusal(`cd: ${args[0]}: not a folder`)
        this.cwd = this.rel(p)
        return 0
      }
      case 'ls': {
        const flags = args.filter(a => a.startsWith('-')).join(''), target = args.find(a => !a.startsWith('-'))
        const { p, info } = await at(target)
        if (!info) throw new Refusal(`ls: ${target}: no such file or folder`)
        if (info.isFile()) { say(target!); return 0 }
        const entries = (await readdir(p, { withFileTypes: true })).filter(e => e.name !== '.git' && e.name !== 'node_modules' && (flags.includes('a') || !e.name.startsWith('.')))
        const names = entries.sort((a, b) => a.name.localeCompare(b.name)).map(e => e.name + (e.isDirectory() ? '/' : ''))
        if (flags.includes('l')) names.forEach(n => say(n))
        else if (names.length) say(names.join('   '))
        return 0
      }
      case 'cat': {
        if (!args.length) throw new Refusal('cat: which file?')
        for (const a of args) (await this.read(this.rel((await at(a)).p))).replace(/\n$/, '').split('\n').forEach(l => say(l))
        return 0
      }
      case 'touch': case 'mkdir': case 'rm': {
        if (!args.length) throw new Refusal(`${cmd}: which path?`)
        for (const a of args.filter(x => !x.startsWith('-'))) {
          const { p, info } = await at(a)
          if (cmd === 'mkdir') await mkdir(p, { recursive: true })
          else if (cmd === 'touch') { if (!info) await this.write(this.rel(p), '') }
          else if (!info) throw new Refusal(`rm: ${a}: no such file`)
          else if (info.isDirectory() && !args.includes('-r') && !args.includes('-rf')) throw new Refusal(`rm: ${a}: is a folder (use rm -r)`)
          else if (p === this.root) throw new Refusal('rm: refusing to remove the project')
          else await rm(p, { recursive: true })
        }
        return 0
      }
      case 'git': {
        const sub = args.find(a => !a.startsWith('-'))
        if (!sub) throw new Refusal('git: which command? Try git status.')
        if (['push', 'pull', 'fetch', 'clone', 'remote'].includes(sub)) throw new Refusal(`git ${sub}: there is no remote on this workstation. Ship with: ldg deploy auth-api --env prod`)
        if (!GIT_SUBCOMMANDS.includes(sub)) throw new Refusal(`git ${sub} is not available here. Try: ${GIT_SUBCOMMANDS.slice(0, 8).join(', ')}.`)
        args.forEach((a, i) => {
          const isMessage = ['-m', '-am'].includes(args[i - 1])
          if (isMessage) return
          if (a.startsWith('-') && !GIT_FLAGS.test(a)) throw new Refusal(`git: the option ${a} is not available here.`)
          if (isAbsolute(a) || a.split('/').includes('..')) throw new Refusal(`git: ${a}: paths must stay inside the project`)
        })
        return (await this.git(args, {}, emit, join(this.root, this.cwd))).code
      }
      case 'npm': {
        // Never npm itself: it would run whatever package.json says, through a shell.
        const test = args[0] === 'test' || args[0] === 't' || (args[0] === 'run' && args[1] === 'test')
        if (!test) throw new Refusal(`npm ${args[0] ?? ''}: only "npm test" is available here. This project has no dependencies to install.`)
        const dash = args.indexOf('--')
        say('')
        say('> ledgerly-api@4.18.2 test', 'dim')
        say('> node --test ' + (dash >= 0 ? args.slice(dash + 1).join(' ') : ''), 'dim')
        say('')
        return this.test(dash >= 0 ? args.slice(dash + 1) : [], emit)
      }
      case 'node': {
        if (args[0] !== '--test') throw new Refusal('node: only "node --test [path]" is available here.')
        return this.test(args.slice(1).filter(a => !a.startsWith('-')), emit)
      }
      default:
        throw new Refusal(`${cmd}: command not found. Type "help" to see what is available.`)
    }
  }
}

const tone = (t: string): TermLine => ({ t, c: /^\s*(✔|ok \d)/.test(t) || /^ℹ pass [1-9]/.test(t) ? 'ok' : /^\s*(✖|not ok)/.test(t) || /^ℹ fail [1-9]/.test(t) || /^(error|fatal):/i.test(t) ? 'err' : /^ℹ|duration_ms|^\s+at /.test(t) ? 'dim' : 'out' })
