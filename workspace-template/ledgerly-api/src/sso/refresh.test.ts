import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeJwt } from '../auth/jwt.ts'
import { mockReq, mockRes } from '../test/helpers.ts'
import { refreshSso } from './refresh.ts'

describe('refreshSso', () => {
  it('returns a new one-hour access token', async () => {
    const { res, seen } = mockRes()
    await refreshSso(mockReq({ body: { refreshToken: 'rt_northwind_ana' } }), res)
    const body = seen.body as { accessToken: string; expiresIn: number }
    assert.equal(body.expiresIn, 3600)
    assert.equal(decodeJwt(body.accessToken)?.sub, 'u_1188')
  })

  it('rejects an unknown refresh token', async () => {
    const { res, seen } = mockRes()
    await refreshSso(mockReq({ body: { refreshToken: 'rt_nope' } }), res)
    assert.equal(seen.status, 401)
  })
})
