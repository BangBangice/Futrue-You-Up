import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authedReq, expiredJwt, mockReq, validJwt } from '../test/helpers.ts'
import { verifySession } from './verifySession.ts'

describe('verifySession', () => {
  it('accepts a valid token', async () => {
    const session = await verifySession(authedReq(validJwt()))
    assert.equal(session.ok, true)
  })

  it('returns the user and organisation', async () => {
    const session = await verifySession(authedReq(validJwt()))
    assert.deepEqual(session, { ok: true, userId: 'u_test', org: 'org_test' })
  })

  it('rejects an expired token', async () => {
    const session = await verifySession(authedReq(expiredJwt()))
    assert.deepEqual(session, { ok: false, reason: 'expired' })
  })

  it('rejects a token that has been tampered with', async () => {
    const session = await verifySession(authedReq(validJwt().slice(0, -3) + 'abc'))
    assert.deepEqual(session, { ok: false, reason: 'bad_token' })
  })

  it('rejects a missing token', async () => {
    const session = await verifySession(mockReq())
    assert.deepEqual(session, { ok: false, reason: 'missing_token' })
  })
})
