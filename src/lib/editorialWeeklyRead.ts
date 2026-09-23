import { EditorialContractError, isEditorialClientId } from './editorialTypes'
import type { EditorialClient, EditorialClientId } from './editorialTypes'
import type { WeeklySlotManifest } from './editorialWeeklyPolicy'
export type WeeklyBriefLink = { slot_id: string; brief_id: string; brief_version: number; linked_at: string }
export type WeeklyReviewRead = {
  state: 'ready' | 'empty'; client_id: EditorialClientId; manifest: WeeklySlotManifest | null
  manifest_hash?: string; frozen_at?: string; links: WeeklyBriefLink[]; available_weeks: string[]; available_plans?: { week_start: string; direction_version: string; manifest_hash: string }[]
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export async function readEditorialWeeklyReview(client: EditorialClient, clientId: string, weekStart: string | null = null, manifestHash: string | null = null): Promise<WeeklyReviewRead> {
  if (!isEditorialClientId(clientId)) throw new EditorialContractError('unknown_client', 'Unknown editorial client.')
  if (weekStart !== null && !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new EditorialContractError('invalid_argument', 'Invalid week date.')
  if (manifestHash !== null && !/^[a-f0-9]{64}$/.test(manifestHash)) throw new EditorialContractError('invalid_argument', 'Invalid manifest hash.')
  const { data, error } = await client.rpc('editorial_read_weekly_review', { p_gate: 'clientops', p_client_id: clientId, p_week_start: weekStart, p_manifest_hash: manifestHash })
  if (error || !object(data)) throw new EditorialContractError('read_failed', 'Saved week could not be read.', error?.message)
  const invalid = () => { throw new EditorialContractError('read_failed', 'Saved week returned inconsistent client, slot or brief identities.') }
  if (data.client_id !== clientId || !Array.isArray(data.links) || !Array.isArray(data.available_weeks) ||
      data.available_weeks.some(w => typeof w !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w))) invalid()
  if (data.available_plans !== undefined && (!Array.isArray(data.available_plans) || data.available_plans.some(p => !object(p) || typeof p.week_start !== 'string' || typeof p.direction_version !== 'string' || typeof p.manifest_hash !== 'string' || !/^[a-f0-9]{64}$/.test(p.manifest_hash)))) invalid()
  if (data.state === 'empty') {
    if (data.manifest !== null || (data.links as unknown[]).length) invalid()
    return data as unknown as WeeklyReviewRead
  }
  const manifest = data.manifest
  if (data.state !== 'ready' || !object(manifest) || manifest.client_id !== clientId || !Array.isArray(manifest.slots) ||
      typeof manifest.direction_version !== 'string' || typeof manifest.week_start !== 'string' ||
      (weekStart !== null && manifest.week_start !== weekStart) || typeof data.manifest_hash !== 'string' || !/^[a-f0-9]{64}$/.test(data.manifest_hash)) invalid()
  if (manifestHash !== null && data.manifest_hash !== manifestHash) invalid()
  const m = manifest as unknown as WeeklySlotManifest
  const ids = new Set(m.slots.map(s => s.slot_id))
  if (ids.size !== m.slots.length || m.slots.some(s => !s.slot_id || s.client_id !== clientId || s.direction_version !== m.direction_version || s.week_start !== m.week_start)) invalid()
  for (const link of data.links as unknown[]) {
    if (!object(link) || !ids.has(String(link.slot_id)) || typeof link.brief_id !== 'string' || !link.brief_id ||
        !Number.isInteger(link.brief_version) || Number(link.brief_version) < 1 || typeof link.linked_at !== 'string') invalid()
  }
  return data as unknown as WeeklyReviewRead
}
