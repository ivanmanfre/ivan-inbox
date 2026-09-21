import { EditorialContractError, isEditorialClientId } from './editorialTypes.ts'
import type { EditorialClient, EditorialClientId } from './editorialTypes.ts'

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
