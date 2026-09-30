// Checks that a file attached from the player's own computer is really stored, served back, kept out of every other
// shift, and thrown away with the run. Run with: npm run check:uploads
//
// It runs against this disk by default. To run it against a bucket instead, start one and point it there:
//   docker compose --profile s3 up -d minio
//   STORAGE=s3 S3_ENDPOINT=http://localhost:9000 S3_BUCKET=larp S3_ACCESS_KEY_ID=larp S3_SECRET_ACCESS_KEY=larp-secret npm run check:uploads
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import express from 'express'
import * as director from './director.ts'
import { api, errors, jsonOnly } from './routes.ts'
import { MAX_UPLOAD, disposition, filename, forget, get, limitLabel, newId, put, storage, typeOf } from './uploads.ts'
import { create, drop, DATA } from './world.ts'

process.env.LLM = 'stub'
// This check reads .data/ directly, as check.ts does. npm run check:db covers Postgres.
delete process.env.DATABASE_URL
console.log(`uploads check · storage: ${storage} · limit: ${limitLabel}`)

// ---- names, types and how they are handed back
assert.equal(filename('../../etc/passwd'), 'etcpasswd', 'a path cannot survive a filename')
assert.equal(filename('.hidden.png'), 'hidden.png', 'nor a leading dot')
assert.equal(filename('a\u0000b\n.png'), 'ab.png', 'nor a control character')
assert.equal(filename(42), '', 'nor a name that is not a string')
assert.equal(filename('x'.repeat(300)).length, 120, 'and a name is cut to something a header can hold')
assert.equal(typeOf('shot.PNG'), 'image/png', 'the type comes from the extension')
assert.equal(typeOf('payload.html'), 'application/octet-stream', 'an unknown extension is not guessed at')
assert.ok(disposition('shot.png', typeOf('shot.png')).startsWith('inline;'), 'an image may render inline')
assert.ok(disposition('notes.txt', typeOf('notes.txt')).startsWith('attachment;'), 'a text file downloads instead')
assert.ok(disposition('logo.svg', typeOf('logo.svg')).startsWith('attachment;'), 'and so does an upload that could run script')
assert.match(disposition('résumé.pdf', typeOf('résumé.pdf')), /filename="r_sum_.pdf"; filename\*=UTF-8''r%C3%A9sum%C3%A9\.pdf/)

// ---- the storage layer on its own, under the run that owns the file
const runA = newId(), runB = newId(), fileId = newId()
const bytes = Buffer.from('what the player attached')
await put(runA, fileId, bytes, 'notes.txt')
// The same file id under another run: never the same file, and forget must not reach across.
await put(runB, fileId, Buffer.from('a different shift'), 'notes.txt')
const back = (await get(runA, fileId))!
assert.deepEqual(back.body, bytes, 'the bytes come back whole')
assert.deepEqual([back.name, back.type], ['notes.txt', 'text/plain'], 'with the name and type they went in with')
assert.equal((await get(runB, fileId))!.body.toString(), 'a different shift', 'the same id under another run is another file')
assert.equal(await get(runA, newId()), null, 'and a missing id is nothing, not an error')
await forget(runA)
assert.equal(await get(runA, fileId), null, 'forget removes the run')
assert.equal((await get(runB, fileId))!.body.toString(), 'a different shift', 'and leaves every other run alone')
await forget(runB)

// ---- the routes, with the same gate and body parsers index.ts mounts
const app = express().use(jsonOnly, express.json({ limit: '300kb' }), api, errors).listen(0)
await once(app, 'listening')
const base = `http://localhost:${(app.address() as AddressInfo).port}`

const run1 = await create('newgrad', '', 4, 'stub')
const run2 = await create('newgrad', '', 4, 'stub')
await director.start(run1)
await director.start(run2)
const stop = async () => { app.close(); await Promise.all([drop(run1.world.id), drop(run2.world.id)]) }
// A copy as a plain Uint8Array: undici takes a Buffer happily, but the DOM's BodyInit type will not admit one.
const send = (run: string, body: Buffer, name = 'shot.png') =>
  fetch(`${base}/sessions/${run}/files?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(body) })

const shot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const stored = await send(run1.world.id, shot, 'Screenshot 2026-09-30 at 13.11.png')
assert.equal(stored.status, 201, 'a file from the player is accepted')
const card = await stored.json() as { kind: string; id: string; name: string; size: number }
assert.deepEqual([card.kind, card.name, card.size], ['upload', card.name, shot.length])
assert.ok(card.id, 'and the answer carries the id the message will refer to')

const download = await fetch(`${base}/sessions/${run1.world.id}/files/${card.id}`)
assert.equal(download.status, 200)
assert.deepEqual(Buffer.from(await download.arrayBuffer()), shot, 'the same bytes come back through the route')
assert.deepEqual(
  ['content-type', 'content-disposition', 'x-content-type-options', 'content-security-policy'].map(h => [h, download.headers.get(h)]),
  [['content-type', 'image/png'], ['content-disposition', `inline; filename="${card.name}"; filename*=UTF-8''${encodeURIComponent(card.name)}`], ['x-content-type-options', 'nosniff'], ['content-security-policy', "default-src 'none'; sandbox"]],
  'served as the file it is, never sniffed and never able to run on our origin',
)

// ---- the shift's own route is the permission check
assert.equal((await fetch(`${base}/sessions/${run2.world.id}/files/${card.id}`)).status, 404, 'another shift cannot fetch it')
assert.equal((await fetch(`${base}/sessions/${run1.world.id}/files/${newId()}`)).status, 404, 'nor can a made-up id')
assert.equal((await fetch(`${base}/sessions/${run1.world.id}/files/..%2F..%2Fetc%2Fpasswd`)).status, 404, 'nor can an id that is a path')
assert.equal((await send(run1.world.id, Buffer.alloc(0), 'empty.png')).status, 400, 'an empty file is refused')
assert.equal((await send(run1.world.id, shot, '')).status, 400, 'and so is one with no name')

// ---- the limit, and the words a player gets for it
const tooBig = await send(run1.world.id, Buffer.alloc(MAX_UPLOAD + 1024))
assert.equal(tooBig.status, 413, 'a file over the limit is refused')
assert.match((await tooBig.json() as { error: string }).error, new RegExp(`too big \\(limit ${limitLabel}\\)`), 'and the player is told the limit in words')

// ---- an attachment is only ever the id the server handed out
const act = (run: string, files: unknown[]) => fetch(`${base}/sessions/${run}/act`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'chat', chan: 'team', text: '', files }),
})
assert.equal((await act(run1.world.id, [{ kind: 'upload', id: card.id, name: card.name, size: card.size }])).status, 200, 'the id is accepted back when the message is sent')
assert.deepEqual(run1.world.chats.team.at(-1)!.files, [{ kind: 'upload', id: card.id, name: card.name, size: card.size }], 'and the message keeps it')
for (const bad of ['../etc/passwd', 'not-a-uuid', '', 42]) {
  assert.equal((await act(run1.world.id, [{ kind: 'upload', id: bad, name: 'x.png', size: 1 }])).status, 400,
    `a forged id (${JSON.stringify(bad)}) leaves nothing to attach, so an empty message is refused`)
}
// A name from the client is cleaned the same way on the way in as it was on the way through storage.
assert.equal((await act(run1.world.id, [{ kind: 'upload', id: card.id, name: '.env', size: 1 }])).status, 200)
assert.deepEqual(run1.world.chats.team.at(-1)!.files, [{ kind: 'upload', id: card.id, name: 'env', size: 1 }], 'the name is cleaned again on the way in')

await stop()
// The disk driver writes under .data; leave nothing of these two runs behind.
await Promise.all([forget(run1.world.id), forget(run2.world.id), ...[run1, run2].map(r => rm(join(DATA, r.world.id), { recursive: true, force: true }))])
console.log(`uploads check passed · storage: ${storage}`)
process.exit(0)
