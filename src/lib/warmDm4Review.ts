// Warm DM4 review (Ivan's seat only). Held DM4 drafts live in their own table, never in outreach_messages, so no
// generic inbox key can touch them. Ivan sees the exact bubbles and the exact image bytes; the approval sends back
// the fingerprint shown and the SHA-256 computed here from the bytes on screen. Any change to the draft or the
// image after that makes the database refuse the approval.
import { supabase } from './supabase'

export const IMAGE_LINE = '[scan trailer image]'

export type WarmDm4Item = {
  id: string
  step: 4 | 5
  state: 'held' | 'uncertain'
  reason: string | null
  variant: 'image' | 'magnet' | 'text' | 'plan' | null
  bubbles: string[]
  preview_sha256: string
  image_sha256: string | null
  image_bytes: number | null
  name: string
  headline: string | null
  company: string | null
  linkedin_url: string | null
  campaign: string
  claimed_at: string
  send_after: string
  receipts: number
  attempts: number
}

export type VerifiedImage = { url: string; sha256: string; bytes: number }

export async function fetchWarmDm4Queue(): Promise<WarmDm4Item[]> {
  const { data, error } = await supabase.rpc('ivan_warm_review_queue')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as WarmDm4Item[]
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Reads the stored bytes and shows them only when their digest equals the digest the draft was held with. */
export async function fetchVerifiedImage(item: WarmDm4Item): Promise<VerifiedImage> {
  if (!item.image_sha256) throw new Error('This draft has no image.')
  const { data, error } = await supabase.rpc('ivan_warm_review_image', { p_rung_id: item.id })
  if (error) throw error
  const row = data as { sha256?: string; bytes?: number; png_base64?: string } | null
  if (!row?.png_base64) throw new Error('The image is no longer available. Refresh.')
  const bytes = fromBase64(row.png_base64)
  const digest = await sha256Hex(bytes)
  if (digest !== item.image_sha256 || digest !== row.sha256 || bytes.length !== item.image_bytes || PNG.some((v, i) => bytes[i] !== v)) {
    throw new Error('The image does not match the draft. Refresh before approving.')
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  return { url, sha256: digest, bytes: bytes.length }
}

export async function approveWarmDm4(item: WarmDm4Item, image: VerifiedImage | null): Promise<void> {
  if (item.image_sha256 && !image) throw new Error('Look at the image first.')
  const { error } = await supabase.rpc('ivan_warm_review_approve', {
    p_rung_id: item.id, p_preview_sha256: item.preview_sha256, p_image_sha256: image ? image.sha256 : null,
  })
  if (error) throw error
}

export async function discardWarmDm4(item: WarmDm4Item): Promise<void> {
  const { error } = await supabase.rpc('ivan_warm_review_discard', { p_rung_id: item.id, p_preview_sha256: item.preview_sha256 })
  if (error) throw error
}
