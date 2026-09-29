import { apiKeyAuth } from '../auth/apiKeyAuth.ts'
import type { Request, Response } from '../http.ts'

const INVOICES = [
  { id: 'inv_9001', org: 'org_northwind', total: 18420, currency: 'AUD', status: 'sent' },
  { id: 'inv_9002', org: 'org_northwind', total: 2310, currency: 'AUD', status: 'draft' },
  { id: 'inv_7710', org: 'org_osprey', total: 960, currency: 'CHF', status: 'paid' },
]

export async function listInvoices(req: Request, res: Response) {
  const who = await apiKeyAuth(req)
  if (!who.ok) return res.status(401).json({ error: who.reason })
  return res.json({ invoices: INVOICES.filter(i => i.org === who.org) })
}
