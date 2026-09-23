import { EditorialContractError, isEditorialClientId } from './editorialTypes.ts'
import type { EditorialClient, EditorialClientId } from './editorialTypes.ts'
import { mergeWeeklyPolicy, validateWeeklyPolicy } from './editorialWeeklyPolicy.ts'
import type { WeeklyPolicy } from './editorialWeeklyPolicy.ts'

export type EditorialDirectionRead = {
  client_id: EditorialClientId
  active_version: string | null
  status: 'active' | 'unadopted'
  audience: unknown | null
  direction: Record<string, unknown> | null
  source: string | null
  updated_at: string | null
}

/** Reads only explicitly adopted direction. Private Notes do not become direction. */
export async function readEditorialDirection(client: EditorialClient, clientId: string): Promise<EditorialDirectionRead> {
  if (!isEditorialClientId(clientId)) throw new EditorialContractError('unknown_client', 'Unknown editorial client.', clientId)
  const { data, error } = await client.rpc('editorial_read_direction', { p_gate: 'clientops', p_client_id: clientId })
  if (error || !data || typeof data !== 'object') throw new EditorialContractError('read_failed', 'Direction read failed.', error?.message ?? '')
  return data as EditorialDirectionRead
}

/** Explicit activation uses the observed version for optimistic concurrency. */
export async function adoptEditorialDirection(
  client: EditorialClient, clientId: string, expectedVersion: string | null,
  direction: Record<string, unknown>, source: string, reason: string, requestId: string,
): Promise<{ state: 'active' | 'conflict'; active_version?: string; observed_version?: string | null }> {
  if (!isEditorialClientId(clientId)) throw new EditorialContractError('unknown_client', 'Unknown editorial client.', clientId)
  if (!source.trim() || !reason.trim() || !requestId.trim()) throw new EditorialContractError('invalid_argument', 'Source, reason, and request ID are required.', 'adoptEditorialDirection')
  const { data, error } = await client.rpc('editorial_adopt_direction', {
    p_gate: 'clientops', p_client_id: clientId, p_expected_version: expectedVersion,
    p_payload: direction, p_source: source, p_reason: reason, p_request_id: requestId,
  })
  if (error || !data || typeof data !== 'object') throw new EditorialContractError('read_failed', 'Direction adoption failed.', error?.message ?? '')
  return data as { state: 'active' | 'conflict'; active_version?: string; observed_version?: string | null }
}

/** Saves one policy while carrying every other direction field forward. */
export async function adoptEditorialWeeklyPolicy(
  client: EditorialClient, clientId: string, expectedVersion: string | null,
  policy: WeeklyPolicy, source: string, reason: string, requestId: string,
): Promise<{ state: 'active' | 'conflict'; active_version?: string; observed_version?: string | null }> {
  if (!isEditorialClientId(clientId)) throw new EditorialContractError('unknown_client', 'Unknown editorial client.', clientId)
  const current = await readEditorialDirection(client, clientId)
  if (current.client_id !== clientId) throw new EditorialContractError('wrong_client', 'Direction belongs to another client.', current.client_id)
  if (current.active_version !== expectedVersion) return { state: 'conflict', observed_version: current.active_version }
  const adopted = { ...policy, status: 'adopted' as const }
  const merged = mergeWeeklyPolicy(current.direction ?? {}, adopted)
  return adoptEditorialDirection(client, clientId, expectedVersion, merged, source, reason, requestId)
}

/** Suggestions are append-only and never change the adopted pointer. */
export async function suggestEditorialWeeklyPolicy(
  client: EditorialClient, clientId: string, observedVersion: string | null,
  policy: WeeklyPolicy, source: string, requestId: string,
): Promise<{ state: 'recorded'; suggestion_id: string }> {
  if (!isEditorialClientId(clientId)) throw new EditorialContractError('unknown_client', 'Unknown editorial client.', clientId)
  const proposed = { ...policy, status: 'proposed' as const }
  const errors = validateWeeklyPolicy(proposed)
  if (errors.length || !source.trim() || !requestId.trim())
    throw new EditorialContractError('invalid_argument', 'Invalid weekly policy suggestion.', errors.join('; ') || 'source and request ID required')
  const { data, error } = await client.rpc('editorial_suggest_weekly_policy', {
    p_gate: 'clientops', p_client_id: clientId, p_observed_version: observedVersion,
    p_policy: proposed, p_source: source, p_request_id: requestId,
  })
  if (error || !data || typeof data !== 'object') throw new EditorialContractError('read_failed', 'Weekly policy suggestion failed.', error?.message ?? '')
  return data as { state: 'recorded'; suggestion_id: string }
}

/** Historical direction is read by exact client and version for draft lineage. */
export async function readEditorialDirectionVersion(client: EditorialClient, clientId: string, version: string): Promise<Record<string, unknown> | null> {
  if (!isEditorialClientId(clientId)) throw new EditorialContractError('unknown_client', 'Unknown editorial client.', clientId)
  if (!version.trim()) throw new EditorialContractError('invalid_argument', 'Direction version is required.')
  const { data, error } = await client.rpc('editorial_read_direction_version', {
    p_gate: 'clientops', p_client_id: clientId, p_version: version,
  })
  if (error) throw new EditorialContractError('read_failed', 'Historical direction read failed.', error.message)
  return data === null ? null : data as Record<string, unknown>
}
