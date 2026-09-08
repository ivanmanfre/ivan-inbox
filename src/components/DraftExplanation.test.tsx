import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DraftExplanation } from './DraftExplanation'

describe('DraftExplanation', () => {
  it('escapes brief text and never renders private reasoning or raw evidence', () => {
    const html = renderToStaticMarkup(<DraftExplanation messageId="dm" messageText="Draft" evidence={{ generated_text: 'Draft', brief: { they_mean: '<script>alert(1)</script>', the_move: 'Answer the question.', reasoning: 'PRIVATE' }, brief_raw: 'PRIVATE' }} />)
    expect(html).toContain('AI assessment of the generated draft')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('PRIVATE')
    expect(html).not.toContain('edited')
  })

  it('keeps each leg associated with its own message and saved generation', () => {
    const html = renderToStaticMarkup(<>
      <DraftExplanation messageId="dm" messageText="DM" evidence={{ generated_text: 'DM', brief: { the_move: 'Confirm by DM.' } }} />
      <DraftExplanation messageId="email" messageText="Email edit" evidence={{ generated_text: 'Email', brief: { the_move: 'Send the details by email.' } }} />
    </>)
    expect(html).toMatch(/data-draft-explanation="dm"[^]*Confirm by DM\.[^]*data-draft-explanation="email"/)
    expect(html).toContain('Send the details by email.')
    expect(html.match(/The text has changed/g)).toHaveLength(1)
  })

  it('shows a saved-generation warning for edits, and unknown provenance for older rows', () => {
    const edited = renderToStaticMarkup(<DraftExplanation messageId="x" messageText="Draft" editedText="My edit" evidence={{ brief: { the_move: 'Answer.' } }} />)
    expect(edited).toContain('The text has changed')
    const old = renderToStaticMarkup(<DraftExplanation messageId="x" messageText="Draft" evidence={{ brief: { the_move: 'Answer.' } }} />)
    expect(old).toContain('Original text was not saved')
    expect(old).not.toContain('The text has changed')
  })

  it('shows a truthful empty state and safe sources without research snippets', () => {
    expect(renderToStaticMarkup(<DraftExplanation messageId="old" messageText="Draft" />)).toContain('No explanation was saved')
    const html = renderToStaticMarkup(<DraftExplanation messageId="x" messageText="Draft" evidence={{ research: [{ hits: [{ url: 'https://example.com', title: 'Source', snippet: 'PRIVATE' }] }] }} />)
    expect(html).toContain('href="https://example.com/"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('PRIVATE')
  })

  it('distinguishes a failed evidence read from an absent saved explanation', () => {
    const html = renderToStaticMarkup(<DraftExplanation messageId="x" messageText="Draft" unavailable onRetry={() => {}} />)
    expect(html).toContain('Explanation could not be loaded.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('No explanation was saved')
  })

  it('does not borrow the DM explanation for a mirror email with only a text snapshot', () => {
    const evidence = { brief: { the_move: 'DM-only plan' }, email: { generated_text: 'Subject: Overview\n\nEmail body' } }
    const html = renderToStaticMarkup(<DraftExplanation messageId="dm:email" messageText={evidence.email.generated_text} evidence={evidence.email} />)
    expect(html).toContain('No explanation was saved')
    expect(html).not.toContain('DM-only plan')
  })
})
