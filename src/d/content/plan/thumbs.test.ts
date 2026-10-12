import { describe, expect, it } from 'vitest'
import { thumbUrl } from './thumbs'

const BASE = 'https://bjbvqvzbzczjbatgmccb.supabase.co/storage/v1'
describe('thumbUrl', () => {
  it('asks Supabase storage for a resized copy', () => {
    expect(thumbUrl(`${BASE}/object/public/client-photos/risedtc-com/a b.png`))
      .toBe(`${BASE}/render/image/public/client-photos/risedtc-com/a b.png?width=360&height=144&resize=cover`)
  })
  it('keeps a query the stored URL already has', () => {
    expect(thumbUrl(`${BASE}/object/public/ig-slides/x.jpg?v=2`)).toBe(`${BASE}/render/image/public/ig-slides/x.jpg?v=2&width=360&height=144&resize=cover`)
  })
  it('leaves other hosts, private objects and empty values alone', () => {
    expect(thumbUrl('https://media.licdn.com/dms/image/abc.jpg')).toBe('https://media.licdn.com/dms/image/abc.jpg')
    expect(thumbUrl(`${BASE}/object/sign/private/x.jpg?token=t`)).toBe(`${BASE}/object/sign/private/x.jpg?token=t`)
    expect(thumbUrl(`${BASE}/render/image/public/x.jpg?width=10`)).toBe(`${BASE}/render/image/public/x.jpg?width=10`)
    expect(thumbUrl('')).toBeNull()
    expect(thumbUrl(null)).toBeNull()
  })
})
