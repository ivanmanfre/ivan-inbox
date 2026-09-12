import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '../../ds'
import { emptyCopy } from './Conversation'
import type { Thread } from '../../lib/inbox'

// R1 · A thread with no bubbles rendered an empty box between the ladder and
// the draft card (on the phone: a blank screen). The pane now renders the
// system's EmptyState there, and WHICH sub-line it renders is the only thing
// the branch decides, so that decision is the unit under test.
const draft = { id: 'd1' } as unknown as NonNullable<Thread['draft']>

describe('emptyCopy', () => {
  it('names the draft below as the first message when one is pending', () => {
    expect(emptyCopy({ draft })).toEqual({
      title: 'No messages yet.',
      sub: 'The draft below is the first one.',
    })
  })

  it('says nothing has happened at all when there is no draft', () => {
    expect(emptyCopy({ draft: null })).toEqual({
      title: 'No messages yet.',
      sub: 'Nothing has been sent or received on this thread yet.',
    })
  })

  it('renders inside the design system EmptyState, both branches', () => {
    const withDraft = renderToStaticMarkup(<EmptyState icon="inbox" {...emptyCopy({ draft })} />)
    expect(withDraft).toContain('data-ds="EmptyState"')
    expect(withDraft).toContain('No messages yet.')
    expect(withDraft).toContain('The draft below is the first one.')
    const bare = renderToStaticMarkup(<EmptyState icon="inbox" {...emptyCopy({ draft: null })} />)
    expect(bare).toContain('Nothing has been sent or received on this thread yet.')
    expect(bare).not.toContain('The draft below')
  })
})
