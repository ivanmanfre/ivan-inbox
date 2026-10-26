import { expect, it } from 'vitest'
import { buildEmailComposition } from './emailCompositionDraft'
import { renderEmailComposition } from './emailRichText'

it('imports a legacy ARCH footer into one visible signature', () => {
  const comp = buildEmailComposition('Subject: Re: Intro\n\nHello\n\nBest regards\n\nDavorin\nARCH', 'davorin@madebyarch.com')
  expect(comp.source_text).toBe('Subject: Re: Intro\n\nHello')
  expect(renderEmailComposition(comp).text.match(/Davorin/g)).toHaveLength(1)
})
it('keeps the selected signature and refuses a source change', () => {
  const comp = buildEmailComposition('Subject: Re: Intro\n\nHello', 'davorin@madebyarch.com')
  comp.signature = null
  expect(buildEmailComposition(comp.source_text, 'davorin@madebyarch.com', { composition: comp }).signature).toBeNull()
  expect(() => buildEmailComposition('Subject: Re: Intro\n\nDifferent body', 'davorin@madebyarch.com', { composition: comp })).toThrow(/formatting changed|refresh/i)
})
