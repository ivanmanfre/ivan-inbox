import { supabase } from './supabase'

function b64ToU8(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
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
