import { describe, expect, it } from 'vitest'
import { thumbUrl } from './thumbs'

const BASE = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1'
describe('thumbUrl', () => {
  it('uses a stored public preview', () => {
    expect(thumbUrl(`${BASE}/object/public/client-photos/risedtc-com/a b.png`))
      .toBe(`${BASE}/object/public/client-photos/_library-thumbnails/w480-h600-q75/risedtc-com/a%20b.png.webp`)
  })
  it('keeps a query the stored URL already has', () => {
    expect(thumbUrl(`${BASE}/object/public/ig-slides/x.jpg?v=2`)).toBe(`${BASE}/object/public/ig-slides/x.jpg?v=2`)
  })
  it('leaves other hosts, private objects and empty values alone', () => {
    expect(thumbUrl('https://media.licdn.com/dms/image/abc.jpg')).toBe('https://media.licdn.com/dms/image/abc.jpg')
    expect(thumbUrl(`${BASE}/object/sign/private/x.jpg?token=t`)).toBe(`${BASE}/object/sign/private/x.jpg?token=t`)
    expect(thumbUrl(`${BASE}/render/image/public/x.jpg?width=10`)).toBe(`${BASE}/render/image/public/x.jpg?width=10`)
    expect(thumbUrl('')).toBeNull()
    expect(thumbUrl(null)).toBeNull()
  })
})
