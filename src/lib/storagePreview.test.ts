import { describe, expect, it } from 'vitest'
import { storedPreviewUrl } from './storagePreview'

const base = 'https://project.supabase.co/storage/v1'
describe('storedPreviewUrl', () => {
  it('uses a stored file for public library images and keeps the version query', () => {
    expect(storedPreviewUrl(`${base}/object/public/post-stills/library/a%20b.jpg?v=2`))
      .toBe(`${base}/object/public/post-stills/_library-thumbnails/w480-h600-q75/library/a%20b.jpg.webp?v=2`)
  })
  it('passes other buckets and private or external URLs through', () => {
    for (const u of [`${base}/object/public/ig-slides/a.jpg?v=2`, `${base}/object/sign/private/a.jpg?token=x`, 'https://media.licdn.com/photo.jpg']) {
      expect(storedPreviewUrl(u)).toBe(u)
    }
  })
  it('uses originals for excluded scratch and one-post folders', () => {
    for (const segment of ['onepost', '_edit_preview']) {
      const original = `${base}/object/public/post-stills/${segment}/a.jpg`
      expect(storedPreviewUrl(original)).toBe(original)
    }
  })
  it('normalizes existing transformed library URLs and is idempotent', () => {
    const original = `${base}/render/image/public/client-photos/arch/a.jpg?width=200&height=200&resize=cover&quality=60&v=2`
    const expected = `${base}/object/public/client-photos/_library-thumbnails/w480-h600-q75/arch/a.jpg.webp?v=2`
    expect(storedPreviewUrl(original)).toBe(expected)
    expect(storedPreviewUrl(expected)).toBe(expected)
  })
})
