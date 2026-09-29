import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeJwt, isExpired, signJwt } from './jwt.ts'

describe('jwt', () => {
  it('round-trips claims', () => {
    const claims = decodeJwt(signJwt({ sub: 'u_1', org: 'org_1' }, { ttlSec: 60, now: 1_000_000 }))
    assert.deepEqual(claims, { sub: 'u_1', org: 'org_1', iat: 1000, exp: 1060 })
  })

  it('refuses a token signed with another secret', () => {
    const [header, payload] = signJwt({ sub: 'u_1', org: 'org_1' }, { ttlSec: 60 }).split('.')
    assert.equal(decodeJwt(`${header}.${payload}.AAAA`), null)
  })

  it('treats a token as expired only after exp plus skew', () => {
    const claims = { sub: 'u_1', org: 'org_1', iat: 0, exp: 100 }
    assert.equal(isExpired(claims, { skewSec: 0, now: 100_000 }), false)
    assert.equal(isExpired(claims, { skewSec: 0, now: 101_000 }), true)
    assert.equal(isExpired(claims, { skewSec: 60, now: 130_000 }), false)
  })
})
