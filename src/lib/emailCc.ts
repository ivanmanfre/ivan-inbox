/** Shared recipient contract: persisted as draft_evidence.email_cc. */
export function parseEmailCc(value: unknown): string[] {
  if (value == null || value === '') return []
  const parts = typeof value === 'string' ? value.split(/[,;\s]+/).filter(Boolean) : value
  if (!Array.isArray(parts)) throw new Error('Enter valid CC email addresses.')
  const seen = new Set<string>()
  return parts.map(p => {
    if (typeof p !== 'string' || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(p.trim())) throw new Error('Enter a valid CC email address.')
    return p.trim()
  }).filter(p => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
}
