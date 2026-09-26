/* ==========================================================================
   The ARCH comment card (2026-09-17).

   The ARCH lane gets its own drafter (`arch-comment-draft`), and it answers
   with an OUTCOME rather than with a draft-or-nothing: it drafts only what
   Davorin has already said in public, and when it cannot it says which of the
   three honest exits this comment takes. The card has to render that verdict —
   chip, reason, what it rests on, and the sources it read — because a card that
   shows an empty editor and no reason reads as a broken drafter.

   The other half of this file is the RISE guarantee. Both lanes render THIS
   card, so every assertion the ARCH half makes is paired with a byte-for-byte
   comparison of the RISE markup against a baseline captured from `main` before
   any of this was written (riseCommentCard.baseline.json). Regenerate it only
   when a RISE-facing change is intended:

     UPDATE_RISE_BASELINE=1 npx vitest run src/wb/ops/PendingCard.arch.test.tsx
   ========================================================================== */
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingCard } from './PendingCard'
import type { OpsDraft } from '../../lib/ops'
import baseline from './riseCommentCard.baseline.json'

const NOW = '2026-09-17T11:00:00Z'

const comment: OpsDraft = {
  id: 'card-1', client_id: 'arch', kind: 'comment_reply', slack_channel: '',
  body: '', context: {}, created_at: '2026-09-17T09:00:00Z',
  approved_at: null, sent_at: null, send_blocked_reason: null,
}

// The four rows below are the real ones from the ARCH lane's first pass over
// Davorin's posts (goal-run arch-comment-lane-davor, 2026-09-17).
const SOURCES = [
  { id: 's1', source_type: 'post', title: 'The €900 repeat-booking post', public: true },
  { id: 's2', source_type: 'call_note', title: 'Kickoff call, 2026-08-14', public: false },
]

const draftCard: OpsDraft = {
  ...comment,
  id: 'arch-draft',
  body: 'Thanks! The math has to work before the booking does.',
  context: {
    comment_id: 'c-draft', author_name: 'Jarne M.', comment_text: 'Fair point!',
    post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1',
    category: 'AGREEMENT', arch_outcome: 'DRAFT',
    arch_reason: 'He has said this in public, so the reply is his own line back.',
    arch_basis: 'Post body: "But if the numbers only support €900, we\'re still overpaying."',
    arch_sources: SOURCES, drafted_at: NOW, draft_version: 1, draft_rounds: 1,
  },
}

const needsDavorCard: OpsDraft = {
  ...comment,
  id: 'arch-needs',
  context: {
    comment_id: 'c-needs', author_name: 'Anna Trifonoff',
    comment_text: "Love this breakdown. One thing I'd be curious about: have you benchmarked freebies vs. discounts as the incentive behind the code?",
    category: 'QUESTION', arch_outcome: 'NEEDS_DAVOR',
    arch_reason: 'She asks for a benchmark of freebies against discounts; he has published no such result.',
    arch_sources: SOURCES, drafted_at: NOW,
  },
}

const escalateCard: OpsDraft = {
  ...comment,
  id: 'arch-escalate',
  context: {
    comment_id: 'c-esc', author_name: 'Kamran Arshad',
    comment_text: 'Repeat bookings are not the check in this market.',
    category: 'CHALLENGE', arch_outcome: 'ESCALATE',
    arch_reason: "A peer pushes back on the repeat-booking check with his own market read; that deserves Davorin's own answer.",
    arch_sources: [SOURCES[0]], drafted_at: NOW,
  },
}

const handledCard: OpsDraft = {
  ...comment,
  id: 'arch-handled',
  context: {
    comment_id: 'c-handled', author_name: 'Jack Gonzalez Hart', comment_text: 'Conor',
    category: 'TAG', arch_outcome: 'HANDLED',
    arch_reason: 'A bare name tag of a third person; nothing to reply to.',
    arch_sources: [], drafted_at: NOW,
  },
}

const undraftedCard: OpsDraft = {
  ...comment,
  id: 'arch-fresh',
  context: { comment_id: 'c-fresh', author_name: 'Anna Trifonoff', comment_text: 'Have you benchmarked this?' },
}

// Both RISE shapes this card can be in: the escalate-empty one (whose editor
// note is the string the ARCH branch used to sit beside) and a drafted one.
const riseEmpty: OpsDraft = {
  ...comment,
  id: 'rise-empty', client_id: 'risedtc',
  context: {
    comment_id: 'c-rise-1', author_name: 'Jarne M.', author_headline: 'Founder, Acme',
    comment_text: 'Fair point!', post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:2',
    category: 'PEER_ELABORATION',
  },
}

const riseDrafted: OpsDraft = {
  ...riseEmpty,
  id: 'rise-drafted',
  body: 'Thanks Jarne — the math has to work before the booking does.',
  context: { ...riseEmpty.context, drafted_on_demand: true, liked: true },
}

function html(draft: OpsDraft): string {
  return renderToStaticMarkup(<PendingCard draft={draft} refresh={() => {}} />)
}

// React derives `useId` from the node's PATH through the tree, so adding a
// conditional branch that renders nothing on this lane still shifts the label's
// generated id (`_R_a_` → `_R_e_`). It is an autogenerated token, identical on
// both ends of every aria-describedby pair, and nothing reads it but React —
// so it is normalised, and everything else is compared byte for byte.
function stableIds(markup: string): string {
  return markup.replace(/_R_[0-9a-z]*_/g, '_ID_')
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)) })
afterEach(() => { vi.useRealTimers() })

describe('an ARCH comment card says what the drafter decided', () => {
  it('invites the drafter, and names its limit, before anything has been drafted', () => {
    const out = html(undraftedCard)
    expect(out).toContain('Press Draft it. The drafter answers only what Davorin has said in public, and says so when it cannot.')
    expect(out).not.toContain('No ARCH drafter exists yet')
    expect(out).toContain('Draft it')
    // No verdict has been reached, so the card claims none.
    expect(out).not.toContain('Rests on:')
    expect(out).not.toContain('Sources')
  })

  it('shows the DRAFT outcome with its reason, what it rests on, and its sources', () => {
    const out = html(draftCard)
    expect(out).toContain('Draft')
    expect(out).toContain('He has said this in public, so the reply is his own line back.')
    expect(out).toContain('Rests on:')
    expect(out).toContain('we&#x27;re still overpaying')
    expect(out).toContain('The €900 repeat-booking post')
    expect(out).toContain('public')
    expect(out).toContain('private, context only')
    expect(out).toContain('Thanks! The math has to work before the booking does.')
    // A body to post means the primary action posts it.
    expect(out).toContain('Approve &amp; post')
  })

  it('shows NEEDS_DAVOR with its reason and no invented draft', () => {
    const out = html(needsDavorCard)
    expect(out).toContain('Needs Davor')
    expect(out).toContain('She asks for a benchmark of freebies against discounts; he has published no such result.')
    // DRAFT is the only outcome that rests on anything.
    expect(out).not.toContain('Rests on:')
    expect(out).not.toContain('Write his reply, or press Draft it.')
  })

  it('shows ESCALATE in his own words and never a placeholder draft', () => {
    const out = html(escalateCard)
    expect(out).toContain('Escalate: answer by hand')
    expect(out).toContain("that deserves Davorin&#x27;s own answer")
    expect(out).not.toContain('Rests on:')
    expect(out).not.toContain('Write his reply, or press Draft it.')
  })

  it('shows HANDLED as a closed question, with no sources block to read', () => {
    const out = html(handledCard)
    expect(out).toContain('No reply needed')
    expect(out).toContain('A bare name tag of a third person; nothing to reply to.')
    expect(out).not.toContain('Sources')
    expect(out).not.toContain('Rests on:')
  })

  it('keeps every ARCH card on Davorin’s seat and offers the three ARCH actions', () => {
    for (const card of [draftCard, needsDavorCard, escalateCard, handledCard, undraftedCard]) {
      const out = html(card)
      expect(out).toContain('>Arch<')
      expect(out).not.toContain('Mattan')
      expect(out).toContain('Needs Davor')
      expect(out).toContain('Mark handled')
      expect(out).toContain('Approve &amp; post')
    }
  })

  it('caps the sources list at five', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`, source_type: 'post', title: `Source number ${i}`, public: i % 2 === 0,
    }))
    const out = html({ ...draftCard, context: { ...draftCard.context, arch_sources: many } })
    expect(out).toContain('Source number 4')
    expect(out).not.toContain('Source number 5')
  })

  it('says the card is waiting on Davorin once it has been stamped', () => {
    const out = html({ ...needsDavorCard, context: { ...needsDavorCard.context, needs_davor: true, needs_davor_at: NOW } })
    expect(out).toContain('waiting on Davorin')
  })
})

// The lane this card has always served. Byte-for-byte against markup captured
// from `main`: anything the ARCH branch leaks into the RISE render fails here.
describe('a RISE comment card is untouched', () => {
  it('renders exactly the markup it rendered before the ARCH branch existed', () => {
    const empty = html(riseEmpty)
    const drafted = html(riseDrafted)
    if (process.env.UPDATE_RISE_BASELINE === '1') {
      writeFileSync(
        new URL('./riseCommentCard.baseline.json', import.meta.url),
        `${JSON.stringify({ empty, drafted }, null, 2)}\n`,
      )
    }
    expect(stableIds(empty)).toBe(stableIds(baseline.empty))
    expect(stableIds(drafted)).toBe(stableIds(baseline.drafted))
  })

  it('keeps Mattan’s copy and carries none of the ARCH furniture', () => {
    const out = html(riseEmpty)
    expect(out).toContain('No draft on purpose: this one wants Mattan in his own words. Type above and the button posts it, or press Draft it for a starting point.')
    expect(out).toContain('>Rise<')
    expect(out).not.toContain('Needs Davor')
    expect(out).not.toContain('Rests on:')
    expect(out).not.toContain('Davorin')
    // The empty RISE card still flips its primary to the close-only action.
    expect(out).toContain('Mark handled')
  })
})
