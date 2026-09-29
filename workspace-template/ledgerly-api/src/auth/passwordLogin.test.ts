import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SESSION_COOKIE } from '../config.ts'
import { mockReq, mockRes } from '../test/helpers.ts'
import { decodeJwt } from './jwt.ts'
import { passwordLogin } from './passwordLogin.ts'

describe('passwordLogin', () => {
  it('signs the user in and sets the session cookie', async () => {
    const { res, seen } = mockRes()
    await passwordLogin(mockReq({ body: { email: 'contractor@northwindfreight.com', password: 'invoice-run-2026' } }), res)
    assert.deepEqual(seen.body, { ok: true })
    assert.equal(decodeJwt(seen.cookies[SESSION_COOKIE])?.org, 'org_northwind')
  })

  it('rejects a wrong password', async () => {
    const { res, seen } = mockRes()
    await passwordLogin(mockReq({ body: { email: 'contractor@northwindfreight.com', password: 'nope' } }), res)
    assert.equal(seen.status, 401)
    assert.deepEqual(seen.cookies, {})
  })
})
