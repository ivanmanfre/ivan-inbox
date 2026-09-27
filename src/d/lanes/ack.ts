/* Acknowledge on a Lanes incident. Today's path (wb/sends/Control.tsx
   IncidentBlock) is a LOCAL flag that changes nothing else: the card says
   "acknowledged, not recovered" and the seat's state word stays what it was.
   D keeps that exactly and only remembers it on this device, per incident
   episode, so a reload does not ask again. No network write, ever. */
import { useCallback, useState } from 'react'

export const ACK_KEY = 'd-lanes-ack-v1'

type Store = Pick<Storage, 'getItem' | 'setItem'>
const store = (): Store | null => (typeof localStorage === 'undefined' ? null : localStorage)

export function readAcks(s: Store | null = store()): Record<string, string> {
  try {
    const v = JSON.parse(s?.getItem(ACK_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {}
  } catch { return {} }
}

/** The key of one episode: the producer's incident key plus its episode id. */
export const ackId = (inc: { incident_key: string; episode_id?: string | null }) => `${inc.incident_key}#${inc.episode_id ?? ''}`

export function writeAck(id: string, at: string = new Date().toISOString(), s: Store | null = store()): Record<string, string> {
  const next = { ...readAcks(s), [id]: at }
  // Keep the newest 50 so the key never grows without bound.
  const trimmed = Object.fromEntries(Object.entries(next).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 50))
  try { s?.setItem(ACK_KEY, JSON.stringify(trimmed)) } catch { /* private window: this tab only */ }
  return trimmed
}

export function useAck(id: string | null, producerAck = false): [boolean, () => void] {
  const [acks, setAcks] = useState(readAcks)
  const ack = useCallback(() => { if (id) setAcks(writeAck(id)) }, [id])
  return [producerAck || (id != null && id in acks), ack]
}
