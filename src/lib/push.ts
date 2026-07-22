import { supabase } from './supabase'

function b64ToU8(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

// What's true for THIS device right now — drives the Settings toggle.
export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

export async function enablePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if ((await Notification.requestPermission()) !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToU8(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: sub.endpoint, p256dh: j.keys!.p256dh, auth: j.keys!.auth, device_label: 'ivan-inbox', user_agent: navigator.userAgent },
    { onConflict: 'endpoint' })
  return !error
}

// Unsubscribe this device and delete its row so the edge fn stops targeting it.
// Delete is endpoint-scoped + device_label-scoped: never touches other tools'
// rows in the shared push_subscriptions table.
export async function disablePush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return true
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    await supabase.from('push_subscriptions').delete()
      .eq('endpoint', endpoint).eq('device_label', 'ivan-inbox')
    return true
  } catch {
    return false
  }
}
