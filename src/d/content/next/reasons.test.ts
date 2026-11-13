import { describe, expect, it } from 'vitest'
import { DEFAULT_REASON, plainReason } from './reasons'

describe('plainReason', () => {
  it('maps each raw reason to its plain sentence', () => {
    expect(plainReason(['animated GIF needs a full-frame review'])).toBe('The loop needs your look. The automatic check only sees its first frame.')
    expect(plainReason(['writer source pack is missing'])).toBe('You changed the text after the automatic check.')
    expect(plainReason(['brain verifier checked different text'])).toBe('You changed the text after the automatic check.')
    expect(plainReason(['automatic pick is held or stale'])).toBe('Its date was changed by hand after the autopilot placed it.')
    expect(plainReason(['queue differs from reviewed final payload: post_text'])).toBe('The queued copy is catching up with the draft.')
    expect(plainReason(['asset review is stale'])).toBe('The attachment changed after the automatic check.')
  })
  it('falls back to one default', () => {
    expect(plainReason([])).toBe(DEFAULT_REASON)
    expect(plainReason(null)).toBe(DEFAULT_REASON)
    expect(plainReason(['manifest mismatch'])).toBe('The automatic check stopped it.')
  })
  it('takes the first rule in order when several reasons match', () => {
    // A GIF fail that also says "asset" is the loop, not a changed attachment.
    expect(plainReason(['asset: animated GIF needs a full-frame review'])).toMatch(/^The loop needs your look/)
    expect(plainReason(['asset review is stale', 'automatic pick is held or stale'])).toMatch(/^Its date was changed by hand/)
    expect(plainReason(['queue differs from reviewed final payload: media_urls', 'writer source pack hash changed'])).toBe('You changed the text after the automatic check.')
  })
  it('does not care about letter case', () => {
    expect(plainReason(['Animated gif needs a full-frame review'])).toMatch(/^The loop needs your look/)
  })
  it('every sentence follows the copy rules', () => {
    const all = [DEFAULT_REASON, ...['animated GIF', 'source pack', 'automatic pick is held or stale', 'queue differs', 'asset'].map(f => plainReason([f]))]
    for (const s of all) { expect(s).not.toMatch(/—|–/); expect(s).not.toMatch(/, not /) }
  })
})
