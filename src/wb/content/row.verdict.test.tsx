// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ContentDraft } from '../../lib/content'
import { ConfirmProvider } from '../chrome/ConfirmSheet'
import { Card } from './row'
import { RowDelete } from './actions'

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia

const draft = (o: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'b1', client_id: null, status: 'review', type: 'text', title: 'A brain post', topic: null, post_body: 'Body.', scheduled_at: null,
  published_at: null, created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', image_urls: null, taxonomy: null,
  board_visible: null, cb34_p2_member: true, ...o,
} as ContentDraft)
const mount = (d: ContentDraft, lane: 'ivan' | 'risedtc' | 'arch' = 'ivan') => render(
  <ConfirmProvider><Card d={d} lane={lane} refresh={vi.fn()} onOpen={vi.fn()} active={false} queue={[d]} /></ConfirmProvider>)
const buttons = () => [...document.querySelectorAll('button')].map(b => b.textContent?.trim())

afterEach(() => { cleanup(); location.hash = '' })

describe('legacy All posts row: a brain draft in review is judged in Review', () => {
  it('shows Judge in Review and no Approve, Skip or Delete', () => {
    mount(draft())
    expect(buttons()).toContain('Judge in Review')
    for (const gone of ['Approve', 'Skip', 'Delete']) expect(buttons()).not.toContain(gone)
  })
  it('an errored brain draft is the same', () => {
    mount(draft({ status: 'error' }))
    expect(buttons()).toContain('Judge in Review')
    expect(buttons()).not.toContain('Approve')
  })
  it('Judge in Review navigates to the Review place', () => {
    mount(draft())
    fireEvent.click(document.querySelector('[data-verb="judge-in-review"]')!)
    expect(location.hash).toBe('#exp/d/content/now')
  })
  it('a Rise brain draft keeps To board but loses Delete', () => {
    mount(draft({ client_id: 'risedtc' }), 'risedtc')
    expect(buttons()).toContain('To board')
    expect(buttons()).toContain('Judge in Review')
    expect(buttons()).not.toContain('Delete')
  })
  it('a normal draft keeps Approve, Skip and Delete', () => {
    mount(draft({ cb34_p2_member: false }))
    expect(buttons()).toEqual(expect.arrayContaining(['Approve', 'Skip', 'Delete']))
    expect(buttons()).not.toContain('Judge in Review')
  })
  it('RowDelete itself renders nothing for a brain draft in review', () => {
    const { container } = render(<ConfirmProvider><RowDelete d={draft()} lane="ivan" onDone={vi.fn()} /></ConfirmProvider>)
    expect(container.querySelector('button')).toBeNull()
  })
})
