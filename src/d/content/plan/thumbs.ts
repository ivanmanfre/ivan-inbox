// Card thumbnails from Supabase storage, resized by the server (render/image) to the card's box at 2x: the stored
// photos are 1080 to 2316 px wide, the card shows 64 px of height. Other hosts are returned as they are.
const OBJECT = /^(https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/)object(\/public\/[^?#]+)(\?[^#]*)?$/i

export const THUMB_PARAMS = 'width=360&height=144&resize=cover'

export function thumbUrl(url: string | null | undefined): string | null {
  const u = String(url ?? '').trim()
  if (!u) return null
  const m = OBJECT.exec(u)
  if (!m) return u
  const q = m[3] ? `${m[3]}&${THUMB_PARAMS}` : `?${THUMB_PARAMS}`
  return `${m[1]}render/image${m[2]}${q}`
}
