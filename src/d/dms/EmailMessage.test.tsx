// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EmailPreview } from './EmailMessage'
import { emailPreview } from '../../lib/emailPresentation'

afterEach(cleanup)

it('renders trusted send HTML with its signature formatting', () => {
  const details = { ...emailPreview('Plain source body', { subject: 'Re: Review', from: 'davorin@madebyarch.com', to: ['alex@example.com'] }),
    html: '<p>Hi &lt;Alex&gt;,</p><p>Cheers,</p><table style="border-left:2px solid #222"><tbody><tr><td><strong>Davorin Šmit</strong><br>ARCH<br><a href="https://arch.agency">arch.agency</a></td></tr></tbody></table>' }
  const { container } = render(<EmailPreview details={details} state="Draft" />)
  expect(screen.getByText('Hi <Alex>,')).toBeTruthy()
  expect(screen.getByText('Davorin Šmit').tagName).toBe('STRONG')
  expect(screen.getByRole('link', { name: 'arch.agency' }).getAttribute('href')).toBe('https://arch.agency')
  expect(container.querySelector('.dm-email-body table')).toBeTruthy()
  expect(screen.queryByText('Plain source body')).toBeNull()
})

it('keeps stored plain-text history escaped when it contains markup', () => {
  const details = { ...emailPreview(''), subject: 'Re: Review', body: '<img src=x onerror=alert(1)>\n\nThanks,\nAlex', html: null }
  const { container } = render(<EmailPreview details={details} state="Received" />)
  expect(container.querySelector('.dm-email-body')!.textContent).toBe('<img src=x onerror=alert(1)>\n\nThanks,\nAlex')
  expect(container.querySelector('img')).toBeNull()
})
