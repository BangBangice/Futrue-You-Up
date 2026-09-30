// Player code in an E2B cloud sandbox (https://e2b.dev) instead of on the app server. Used when E2B_API_KEY is set.
// One sandbox per shift, made on the first run and kept while the shift is active. Each run pushes its idle timeout
// out again, so an abandoned shift's sandbox dies on its own and costs nothing.
// The shift's directory on the app server stays the record of the work: git, reads and writes happen there, and before
// each run the files that changed are copied in. So a sandbox can expire or die at any time and nothing is lost:
// the next run makes a new one.
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { ALL_TRAFFIC, CommandExitError, Sandbox } from 'e2b'
import { ACCEPTANCE, Refusal } from './sandbox.ts'
import type { Proc, Runner } from './sandbox.ts'

const IDLE = 10 * 60_000
const HOME = '/home/user', ROOT = `${HOME}/workspace`, HARNESS = `${HOME}/.larp/acceptance.ts`, OWN_NODE = `${HOME}/.node`
/** All the player's code gets. Never the server's environment: that is where the API keys live. */
const ENV = { HOME, TMPDIR: '/tmp', LANG: 'en_US.UTF-8', TERM: 'dumb', NO_COLOR: '1', FORCE_COLOR: '0', NODE_OPTIONS: '' }
// The default template's Node may be older than the server's, which the flags in sandbox.ts are written for.
// If so, the server's own version is fetched from nodejs.org, before the network is cut off. Prints the node to use.
const SETUP = `set -eo pipefail
mkdir -p ${ROOT} ${HOME}/.larp
want=\${WANT#v}
have=$(node -p process.versions.node 2>/dev/null || echo 0)
if [ "\${have%%.*}" -ge "\${want%%.*}" ]; then command -v node; exit 0; fi
case "$(uname -m)" in aarch64|arm64) arch=arm64;; *) arch=x64;; esac
url=https://nodejs.org/dist/v$want/node-v$want-linux-$arch.tar.gz
mkdir -p ${OWN_NODE}
if command -v curl >/dev/null; then curl -fsSL "$url"; else wget -qO- "$url"; fi | tar -xz -C ${OWN_NODE} --strip-components=1
echo ${OWN_NODE}/bin/node`

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
const unreachable = (what: string, e: unknown) => {
  console.error(`[e2b] ${what}:`, e)
  return new Refusal('The machine that runs code could not be reached, so nothing ran. Try again in a minute.')
}

export class Remote implements Runner {
  readonly root = ROOT
  readonly acceptance = HARNESS
  private box: Promise<{ sb: Sandbox; node: string }> | null = null
  /** What the sandbox holds, by path, as of the last sync. */
  private synced = new Map<string, string>()
  /** `local` is the shift's directory on this server; `shift` labels the sandbox in E2B's dashboard and in the logs. */
  private readonly local: string
  private readonly shift: string
  constructor(local: string, shift: string) { this.local = local; this.shift = shift }

  async node(args: string[], take: (text: string) => void): Promise<Proc> {
    let box: { sb: Sandbox; node: string }
    try {
      box = await this.sandbox()
      await this.sync(box.sb)
    } catch (e) { throw unreachable(`shift ${this.shift}: no sandbox`, e) }
    const handle = await box.sb.commands.run([box.node, ...args].map(quote).join(' '), {
      background: true, cwd: ROOT, envs: ENV, onStdout: take, onStderr: take, timeoutMs: 60_000,
    }).catch(e => { throw unreachable(`shift ${this.shift}: could not start node`, e) })
    const done = handle.wait().then(r => r.exitCode, e => {
      if (e instanceof CommandExitError) return e.exitCode
      console.error(`[e2b] shift ${this.shift}: lost the command`, e)
      take('\nThe machine running this stopped answering.\n')
      return 1
    })
    return { kill: () => void handle.kill().catch(() => {}), done }
  }

  async close() {
    const box = this.box
    this.box = null
    this.synced.clear()
    const sb = (await box?.catch(() => null))?.sb
    await sb?.kill().catch(e => console.error(`[e2b] shift ${this.shift}: could not kill sandbox ${sb.sandboxId}`, e))
  }

  /** The shift's sandbox, made if there is none or the last one has expired. */
  private async sandbox() {
    const old = this.box
    if (old) {
      const box = await old.catch(() => null)
      // Pushes the idle timeout out again, and finds out whether the sandbox is still there.
      if (box && await box.sb.setTimeout(IDLE).then(() => true, () => false)) return box
      if (this.box === old) this.box = null
      if (box) console.log(`[e2b] shift ${this.shift}: sandbox ${box.sb.sandboxId} is gone, making a new one`)
    }
    if (!this.box) {
      this.synced.clear()
      this.box = this.create()
    }
    return this.box
  }

  private async create() {
    const t = Date.now()
    const sb = await Sandbox.create({ apiKey: process.env.E2B_API_KEY, timeoutMs: IDLE, metadata: { app: 'larp', shift: this.shift } })
    try {
      const setup = await sb.commands.run(SETUP, { envs: { WANT: process.versions.node }, timeoutMs: 120_000 })
      const node = setup.stdout.trim().split('\n').at(-1)!
      await sb.files.write(HARNESS, await readFile(ACCEPTANCE, 'utf8'))
      // No way out to the internet from here on. If E2B refuses, player code is still walled off from this server,
      // and the preload in sandbox.ts still takes away Node's network modules, so say so loudly and carry on.
      await sb.updateNetwork({ denyOut: [ALL_TRAFFIC] }).catch(e => console.error(`[e2b] shift ${this.shift}: could not cut sandbox ${sb.sandboxId} off from the internet`, e))
      console.log(`[e2b] shift ${this.shift}: sandbox ${sb.sandboxId} ready in ${Date.now() - t} ms (node ${node})`)
      return { sb, node }
    } catch (e) {
      void sb.kill().catch(() => {})
      throw e
    }
  }

  /** Copies in what changed since the last run, and removes what the player deleted. */
  private async sync(sb: Sandbox) {
    const now = new Map<string, string>()
    for (const e of await readdir(this.local, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue
      const rel = relative(this.local, join(e.parentPath, e.name)).split(sep).join('/')
      if (!/^(\.git|node_modules)(\/|$)/.test(rel)) now.set(rel, await readFile(join(e.parentPath, e.name), 'utf8'))
    }
    const changed = [...now].filter(([p, text]) => this.synced.get(p) !== text)
    const gone = [...this.synced.keys()].filter(p => !now.has(p))
    if (changed.length) await sb.files.writeFiles(changed.map(([p, data]) => ({ path: `${ROOT}/${p}`, data })))
    if (gone.length) await sb.commands.run(['rm', '-f', '--', ...gone.map(p => `${ROOT}/${p}`)].map(quote).join(' '))
    changed.forEach(([p, text]) => this.synced.set(p, text))
    gone.forEach(p => this.synced.delete(p))
  }
}
