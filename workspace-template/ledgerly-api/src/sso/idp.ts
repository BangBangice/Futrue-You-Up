// Stand-in for the identity provider client. Real refresh tokens are opaque strings issued by the customer's IdP.
const SESSIONS: Record<string, { userId: string; orgId: string }> = {
  rt_northwind_ana: { userId: 'u_1188', orgId: 'org_northwind' },
  rt_brightline_kai: { userId: 'u_4102', orgId: 'org_brightline' },
}

export const idp = {
  async refresh(refreshToken: unknown): Promise<{ userId: string; orgId: string } | null> {
    return typeof refreshToken === 'string' ? SESSIONS[refreshToken] ?? null : null
  },
}
