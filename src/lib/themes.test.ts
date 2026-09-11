import { describe, expect, it } from 'vitest'
import { angleLabel, angleMix, fitLine, outlierRatio, themeLabel } from './themes'

describe('themes helpers', () => {
  it('labels known themes and angles, passes unknown ones through', () => {
    expect(themeLabel('poland')).toBe('Poland')
    expect(themeLabel('untagged')).toBe('Not yet read')
    expect(themeLabel('weird')).toBe('weird')
    expect(angleLabel('how_to')).toBe('how-to')
    expect(angleLabel(null)).toBe('unread')
  })

  it('fitLine never prints a share on a handful and says when nobody was scored', () => {
    expect(fitLine(0, 0)).toBe('no engagers scored yet')
    expect(fitLine(4, 1)).toBe('4 engaged · 1 fit')
    expect(fitLine(20, 5)).toBe('20 engaged · 5 fit (25%)')
  })

  it('angleMix orders the moves biggest first', () => {
    expect(angleMix({ story: 2, polemic: 4 })).toBe('polemic 4 · story 2')
    expect(angleMix(null)).toBe('')
  })

  it('outlierRatio names the tail only when it is one', () => {
    expect(outlierRatio(5152, 80)).toBe('64× its median')
    expect(outlierRatio(120, 80)).toBe('1.5× its median')
    expect(outlierRatio(100, 80)).toBeNull()
    expect(outlierRatio(100, null)).toBeNull()
  })
})
