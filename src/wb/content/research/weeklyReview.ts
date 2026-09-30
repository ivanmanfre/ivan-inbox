import type { EditorialBrief, BriefAccessGap } from '../../../lib/editorialTypes'
import type { WeeklySlotManifest } from '../../../lib/editorialWeeklyPolicy'

export function groupBriefVersions(items: (EditorialBrief | BriefAccessGap)[]): (EditorialBrief | BriefAccessGap)[][] {
  const groups = new Map<string, (EditorialBrief | BriefAccessGap)[]>()
  for (const item of items) {
    const key = `${item.identity.client_id}:${item.identity.brief_id}`
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group)
  }
  return [...groups.values()].map(group => group.sort((a, b) => b.identity.version - a.identity.version))
}

export function weekRefreshBlock(manifest: Pick<WeeklySlotManifest, 'direction_version' | 'contract_version' | 'policy_status'> | null, current: string | null, saved: boolean, hash: string | null): string | null {
  if (!current) return 'Adopt client direction before refreshing suggestions.'
  if (!manifest) return 'Read a usable weekly plan before refreshing suggestions.'
  if (saved && manifest.direction_version !== current) return 'This saved week uses an earlier direction. Refresh requires a saved evidence plan for the current direction.'
  if (manifest.contract_version === 1 && (!saved || !hash)) return 'This policy preview needs a saved evidence plan before suggestions can be refreshed.'
  const snapshot = (manifest as { policy_snapshot?: { suggestion_id?: string } }).policy_snapshot
  if (manifest.policy_status === 'proposed' && !snapshot?.suggestion_id) return 'The saved proposal is missing its source identity. Refresh is unavailable.'
  return null
}
