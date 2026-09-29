// API keys for machine-to-machine access.
const KEYS: Record<string, { orgId: string; label: string }> = {
  ldg_live_osprey_7f3a91: { orgId: 'org_osprey', label: 'Osprey nightly export' },
  ldg_live_brightline_22c4: { orgId: 'org_brightline', label: 'Brightline booking sync' },
}

export async function lookupKey(key: string): Promise<{ orgId: string; label: string } | null> {
  return KEYS[key] ?? null
}
