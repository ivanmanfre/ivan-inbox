// linkcards.ts — pure presentation mapping from an `unfurl()` result (or its
// pending/absent states) to what the composer's preview card and the sent
// turn's inline card actually print.
//
// Brief item 5: "YouTube 16:9 thumb + title + channel; LinkedIn post title +
// author; Instagram title/thumbnail when available, else an honest
// 'Instagram gave nothing back' mini card; generic OG". This is where those
// four shapes are decided, kept apart from the component that draws them so
// the copy is testable without a network or a DOM.

import type { LinkKind, UnfurlResult } from '../../../lib/unfurl'

export type LinkCardState = 'loading' | 'ready' | 'failed'

export type LinkCardModel = {
  state: LinkCardState
  kind: LinkKind
  title: string | null
  /** The line under the title: a channel, an author, a site — whichever the kind has. */
  sub: string | null
  image: string | null
  aspect: '16:9' | 'square' | null
}

/** The card while the request is in flight. */
export function pendingLinkCard(kind: LinkKind): LinkCardModel {
  return { state: 'loading', kind, title: null, sub: null, image: null, aspect: kind === 'youtube' ? '16:9' : null }
}

// The one place an unfurl failure becomes copy. Instagram gets its own named
// sentence (brief: "an honest 'Instagram gave nothing back' mini card")
// because a blocked logged-out fetch is Instagram's own doing and saying so
// plainly beats a generic "couldn't load a preview" that reads like our bug.
function failedTitle(kind: LinkKind, reason: string): string {
  if (kind === 'instagram') return 'Instagram gave nothing back'
  if (reason === 'not_signed_in') return 'Sign in to preview this link'
  return 'No preview available'
}

/** Map one `unfurl()` result onto what the card prints. Never throws. */
export function linkCardFromResult(kind: LinkKind, result: UnfurlResult): LinkCardModel {
  if (!result.ok) {
    return {
      state: 'failed', kind, title: failedTitle(kind, result.reason),
      sub: null, image: null, aspect: null,
    }
  }
  const sub = result.kind === 'youtube' ? result.author
    : result.kind === 'linkedin' ? result.author
      : result.kind === 'instagram' ? result.author
        : result.site
  return {
    state: 'ready',
    kind,
    title: result.title,
    sub: sub ?? null,
    image: result.image,
    aspect: result.kind === 'youtube' ? '16:9' : result.image ? 'square' : null,
  }
}
