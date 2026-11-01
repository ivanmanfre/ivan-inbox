import { describe, expect, it } from 'vitest'
import { laneOnScreen } from './Palette'

describe('laneOnScreen', () => {
  it('reads ?lane= then ?seat= from the address', () => {
    expect(laneOnScreen('#exp/d/content?lane=arch', null)).toBe('arch')
    expect(laneOnScreen('#exp/d/dms?seat=risedtc&thread=x', 'arch')).toBe('risedtc')
  })
  it('on the DMs page with no seat in the address, uses the remembered seat', () => {
    expect(laneOnScreen('#exp/d/dms', 'arch')).toBe('arch')
    expect(laneOnScreen('#exp/d/dms?thread=p1', 'swishdm')).toBe('swishdm')
  })
  it('other pages ignore the remembered DMs seat', () => {
    expect(laneOnScreen('#exp/d/home', 'arch')).toBe('ivan')
    expect(laneOnScreen('#exp/d/dms', null)).toBe('ivan')
  })
})
