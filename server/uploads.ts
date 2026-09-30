// Where a file the player attaches from their own computer actually lives. The world only ever holds a name, a size
// and an id (shared/types.ts); the bytes stay here and are fetched back through the shift's own route, which is also
// the ownership check: a file is only ever looked up under the run that stored it, so one shift cannot read another's.
//
// Two places to keep them. This server's disk, under the same .data volume as the shifts, is the default and all a
// single instance needs. An S3-compatible bucket is for a host whose disk does not survive a deploy: Railway's own
// storage bucket in production, MinIO locally (`docker compose --profile s3`). `npm run check:uploads` covers both.
import { AwsClient } from 'aws4fetch'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'uploads')

/** Big enough for a screenshot or a log, small enough to read into memory and to keep out of a database's backups. */
export const MAX_UPLOAD = Number(process.env.UPLOAD_MAX_BYTES?.trim() || 5 * 1024 * 1024)
/** The same limit in words, for the one message a player sees when their file is turned away. */
export const limitLabel = MAX_UPLOAD >= 1024 * 1024 ? `${Math.round(MAX_UPLOAD / 1024 / 1024)} MB` : `${Math.max(1, Math.round(MAX_UPLOAD / 1024))} KB`

/** The id becomes a path segment and an object key, so it is checked before it is used as one. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const newId = () => randomUUID()
export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)

/** The player's name for the file, minus anything that could escape a header, a path or a download prompt. */
export function filename(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/^\.+/, '').trim().slice(0, 120)
}

// Types are read from the extension, never from what the browser claimed: that claim decides how we serve it back.
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', mp4: 'video/mp4', mp3: 'audio/mpeg',
}
export const typeOf = (name: string) => TYPES[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'

// What a browser may render from our own origin. An uploaded .svg or .html served inline would run its script as us.
const RENDER = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])
export const renderable = (type: string) => RENDER.has(type)

export function disposition(name: string, type: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${renderable(type) ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export interface Blob { body: Buffer; name: string; type: string }

interface Store {
  put(run: string, id: string, body: Buffer, name: string, type: string): Promise<void>
  get(run: string, id: string): Promise<Blob | null>
  /** Everything one shift uploaded, in one go, when its account is deleted. */
  forget(run: string): Promise<void>
}

const disk: Store = {
  async put(run, id, body, name, type) {
    const path = join(ROOT, run, id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    // The bytes and what they are, side by side: nothing else records the name the player chose.
    await writeFile(path + '.json', JSON.stringify({ name, type }))
  },
  async get(run, id) {
    const path = join(ROOT, run, id)
    try {
      const [body, meta] = await Promise.all([readFile(path), readFile(path + '.json', 'utf8')])
      return { body, ...(JSON.parse(meta) as { name: string; type: string }) }
    } catch {
      return null
    }
  },
  forget: run => rm(join(ROOT, run), { recursive: true, force: true }),
}

// Every name a bucket's settings go by. Ours come first, then Railway's own bucket variables, then the names the AWS
// SDKs read, which Railway's credential presets also inject.
const VAR = {
  bucket: ['S3_BUCKET', 'BUCKET', 'AWS_S3_BUCKET_NAME'],
  endpoint: ['S3_ENDPOINT', 'ENDPOINT', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL'],
  key: ['S3_ACCESS_KEY_ID', 'ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'],
  secret: ['S3_SECRET_ACCESS_KEY', 'SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'],
  region: ['S3_REGION', 'REGION', 'AWS_REGION'],
} as const
const env = (names: readonly string[]) => names.map(n => process.env[n]?.trim()).find(Boolean)

/** Which driver this environment asks for. A half-configured bucket is an error rather than a quiet fall back to a
 *  disk that the next deploy throws away. */
function choose(): 'disk' | 's3' {
  const want = process.env.STORAGE?.trim().toLowerCase()
  if (want && want !== 'disk' && want !== 's3') throw new Error(`STORAGE must be "disk" or "s3", not "${want}"`)
  if (want === 'disk') return 'disk'
  const fields = ['bucket', 'endpoint', 'key', 'secret'] as const
  const missing = fields.filter(f => !env(VAR[f]))
  // Without STORAGE, only a bucket someone actually started configuring is taken as one.
  if (!want && missing.length === fields.length) return 'disk'
  if (missing.length) throw new Error(`an S3 bucket needs ${missing.map(f => VAR[f][0]).join(', ')}; set STORAGE=disk to keep files on this server instead`)
  return 's3'
}

/** An S3-compatible bucket: Railway's storage bucket, MinIO, or anything else that speaks the same API. */
const signer = (retries = 10) => new AwsClient({
  accessKeyId: env(VAR.key)!, secretAccessKey: env(VAR.secret)!,
  region: env(VAR.region) ?? 'us-east-1', service: 's3', retries,
})
let signing: AwsClient | undefined
const client = () => (signing ??= signer())
// Path style unless told otherwise: MinIO and Railway's bucket both answer it, and it needs no wildcard DNS.
const base = () => (process.env.S3_VIRTUAL_HOST === '1'
  ? `${env(VAR.endpoint)!.replace(/\/+$/, '').replace('://', `://${env(VAR.bucket)!}.`)}`
  : `${env(VAR.endpoint)!.replace(/\/+$/, '')}/${env(VAR.bucket)!}`)

const unescapeXml = (t: string) => t.replace(/&(amp|lt|gt|quot|#39);/g, c => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[c]!)

function bucket(): Store {
  const fail = (what: string, res: Response) => new Error(`the bucket would not ${what} (${res.status} ${res.statusText.trim()})`)
  return {
    async put(run, id, body, name, type) {
      const res = await client().fetch(`${base()}/${run}/${id}`, {
        // A plain view of the same bytes: undici takes a Buffer, but the DOM's BodyInit type does not admit one.
        method: 'PUT', body: new Uint8Array(body),
        headers: { 'content-type': type, 'x-amz-meta-name': encodeURIComponent(name) },
      })
      if (!res.ok) throw fail('store a file', res)
    },
    async get(run, id) {
      const res = await client().fetch(`${base()}/${run}/${id}`)
      if (res.status === 404) return null
      if (!res.ok) throw fail('read a file', res)
      return {
        body: Buffer.from(await res.arrayBuffer()),
        name: decodeURIComponent(res.headers.get('x-amz-meta-name') ?? ''),
        type: res.headers.get('content-type') ?? 'application/octet-stream',
      }
    },
    async forget(run) {
      let token: string | undefined
      do {
        const url = new URL(base())
        url.searchParams.set('list-type', '2')
        url.searchParams.set('prefix', `${run}/`)
        if (token) url.searchParams.set('continuation-token', token)
        const res = await client().fetch(url.toString())
        if (!res.ok) throw fail('list files', res)
        const xml = await res.text()
        // One at a time rather than the multi-object Delete: a shift uploads a handful, and this needs no XML body.
        for (const key of [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map(m => unescapeXml(m[1]))) {
          const gone = await client().fetch(`${base()}/${key}`, { method: 'DELETE' })
          if (!gone.ok && gone.status !== 404) throw fail(`delete ${key}`, gone)
        }
        const more = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]*)</.exec(xml)?.[1] : undefined
        token = more ? unescapeXml(more) : undefined
      } while (token)
    },
  }
}

export const storage = choose()
const driver: Store = storage === 's3' ? bucket() : disk

export const put = (run: string, id: string, body: Buffer, name: string) => driver.put(run, id, body, name, typeOf(name))
export const get = (run: string, id: string) => driver.get(run, id)
export const forget = (run: string) => driver.forget(run).catch(err => {
  // Losing the bytes of a shift that is being deleted anyway must not fail the deletion.
  console.warn(`[uploads] ${run}: not every uploaded file was removed —`, (err as Error).message)
})

/** For the startup log, and a complaint now rather than at the first attach if the bucket is wrong. */
export async function storageStatus(): Promise<string> {
  if (storage === 'disk') return `uploads: this disk (${ROOT.replace(process.cwd() + '/', '')})`
  const where = `uploads: the "${env(VAR.bucket)}" bucket at ${env(VAR.endpoint)}`
  try {
    // One try only: a bucket answering 5xx should not hold the server's startup for the client's ten retries.
    const res = await signer(1).fetch(`${base()}?list-type=2&max-keys=1`)
    return res.ok ? where : `${where} — it answered ${res.status}, so attaching will fail`
  } catch (err) {
    return `${where} — unreachable (${(err as Error).message}), so attaching will fail`
  }
}
