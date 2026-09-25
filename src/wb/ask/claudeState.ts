/* ==========================================================================
   src/wb/ask/claudeState.ts: small state pieces of the phone Claude screen.

   The live-voice loader (D7): P3 owns src/wb/ask/voice/**. Until it lands the
   glob is empty, the lime button dictates, and the build never breaks.
   ========================================================================== */
import { lazy, useEffect, useState, type ComponentType } from 'react'
import type { Turn } from '../../exp/v2c/chat/events'

export type LiveVoiceProps = { onClose(): void; send(text: string): void; turns: Turn[] }
const voiceModules = import.meta.glob<{ LiveVoice: ComponentType<LiveVoiceProps> }>('./voice/index.{ts,tsx}')
const voiceLoader = Object.values(voiceModules)[0]
export const LiveVoice = voiceLoader ? lazy(() => voiceLoader().then(m => ({ default: m.LiveVoice }))) : null

export const VOICE_HASH = /^#claude\/voice\b/

/** The browser's own word on the network, kept current. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

const SAVED_KEY = 'claude-thread-saved-at'

/**
 * When the thread was last known good while online. That instant is what the
 * offline mark says, never the time the network dropped.
 */
export function useSavedAt(online: boolean, turns: number, busy: boolean): number | null {
  const [savedAt, setSavedAt] = useState<number | null>(() => {
    try { const v = Number(localStorage.getItem(SAVED_KEY)); return v > 0 ? v : null } catch { return null }
  })
  useEffect(() => {
    if (!online || turns === 0) return
    const now = Date.now()
    setSavedAt(now)
    try { localStorage.setItem(SAVED_KEY, String(now)) } catch { /* private mode */ }
  }, [online, turns, busy])
  return savedAt
}

export function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Alert rows (groups) with anything unread: the same count the dots show. */
export function unreadRows(groups: { unread: number }[]): number {
  return groups.filter(g => g.unread > 0).length
}
