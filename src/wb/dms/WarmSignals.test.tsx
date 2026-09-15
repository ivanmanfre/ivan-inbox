import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LinkedInProfileAccess } from './WarmSignals'

describe('LinkedInProfileAccess', () => {
  it('renders the saved member profile as a new-tab link', () => {
    const html = renderToStaticMarkup(<LinkedInProfileAccess url="https://www.linkedin.com/in/giorgiomhanna" />)
    expect(html).toContain('href="https://www.linkedin.com/in/giorgiomhanna"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('Open LinkedIn')
  })

  it('renders profile unavailable instead of an unsafe destination', () => {
    const html = renderToStaticMarkup(<LinkedInProfileAccess url="javascript:alert(1)" />)
    expect(html).toContain('LinkedIn profile unavailable')
    expect(html).not.toContain('<a')
  })
})
