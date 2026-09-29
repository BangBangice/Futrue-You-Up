import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mockReq } from '../test/helpers.ts'
import { apiKeyAuth } from './apiKeyAuth.ts'

describe('apiKeyAuth', () => {
  it('accepts a known key', async () => {
    const who = await apiKeyAuth(mockReq({ headers: { 'x-api-key': 'ldg_live_osprey_7f3a91' } }))
    assert.deepEqual(who, { ok: true, org: 'org_osprey' })
  })

  it('rejects an unknown key', async () => {
    const who = await apiKeyAuth(mockReq({ headers: { 'x-api-key': 'ldg_live_nope' } }))
    assert.deepEqual(who, { ok: false, reason: 'bad_key' })
  })
})
