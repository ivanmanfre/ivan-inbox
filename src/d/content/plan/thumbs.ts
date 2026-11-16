import { storedPreviewUrl } from '../../../lib/storagePreview'

export function thumbUrl(url: string | null | undefined): string | null {
  const value = String(url ?? '').trim()
  return value ? storedPreviewUrl(value) : null
}
