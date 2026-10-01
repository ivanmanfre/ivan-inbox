import { useEffect, useState } from 'react'
import type { ContentDraft } from '../../lib/content'
import { fetchDraftReads, noRead, type PatternRead } from '../../lib/earlyReads'
import { LANES, type Lane } from './model'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const loading = (): PatternRead => ({ ...noRead(), state: 'loading', reason: 'Reading the stored niche evidence…' })
type Row = { id: string; lane: Lane; body: string; version: string }

// One bounded batch per lane, never a request per card. Compare the server's
// current hash with the body actually on screen before exposing a percentage.
export function useEarlyReads(rows: ContentDraft[]): Map<string, PatternRead> {
  const key = JSON.stringify(rows.flatMap(r => {
    const lane = r.client_id == null || r.client_id === 'ivan' ? 'ivan' : r.client_id
    return uuid.test(r.id) && LANES.includes(lane as Lane) ? [{ id: r.id, lane, body: r.post_body ?? '', version: r.updated_at }] : []
  }))
  const [result, setResult] = useState<{ key: string; rows: Map<string, PatternRead> }>({ key: '', rows: new Map() })
  useEffect(() => {
    const requested = JSON.parse(key) as Row[]
    if (!requested.length) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()
    const run = async () => {
      const reads = new Map<string, PatternRead>()
      for (const lane of LANES) {
        const mine = requested.filter(r => r.lane === lane)
        for (let start = 0; start < mine.length; start += 100) {
          const batch = mine.slice(start, start + 100)
          try {
            const answer = await fetchDraftReads(lane, batch.map(r => r.id), controller.signal)
            for (const row of batch) {
              let read: PatternRead = answer.find(r => r.draftId === row.id) ?? noRead('This draft has no stored read yet.')
              if (read.state === 'ready') {
                const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.body))
                const expected = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
                if (read.bodyHash !== expected) read = noRead('The body changed. Waiting for a read of this version.')
              }
              reads.set(row.id, read)
            }
          } catch (e) {
            for (const row of batch) reads.set(row.id, { ...noRead(), state: 'failed', reason: e instanceof Error ? e.message : 'Could not read the stored evidence.' })
          }
          if (!live) return
        }
      }
      if (!live) return
      setResult({ key, rows: reads })
      if ([...reads.values()].some(r => r.state !== 'ready')) timer = setTimeout(() => { void run() }, 60_000)
    }
    void run()
    return () => { live = false; controller.abort(); if (timer) clearTimeout(timer) }
  }, [key])
  if (result.key === key) return result.rows
  return new Map(rows.map(r => [r.id, uuid.test(r.id) ? loading() : noRead('No stored read is available for this draft.')] ))
}
