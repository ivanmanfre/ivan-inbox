// linkPreview.ts — pure mapping from an `unfurl()` result (src/lib/unfurl.ts)
// to what the composer's preview card and the sent-turn card actually render.
// The network call lives in unfurl.ts; this file only decides which fields to
// show and how to word a failure, so the mapping is testable without a
// broker.
import type { UnfurlResult } from '../../../lib/unfurl'

export type LinkCard =
  | { ok: true; kind: 'youtube' | 'linkedin' | 'instagram' | 'og'; title: string; sub: string | null; image: string | null; ratio: '16:9' | null }
  | { ok: false; kind: string; message: string }

// Named, honest failure sentences — never "something went wrong". Instagram
// gets its own line per the mission's explicit case: IG blocks unauthenticated
// fetches, so an empty result is the TRUE state, not a bug to paper over.
function failMessage(reason: string, kind?: string): string {
  if (kind === 'instagram') return 'Instagram gave nothing back'
  switch (reason) {
    case 'not_signed_in': return 'Sign in to preview links'
    case 'no_title': return 'That page has nothing to preview'
    case 'no_preview': return 'No preview available'
    case 'not_a_url': return 'Not a link'
    default: return 'Could not load a preview'
  }
}

/** Pure: `UnfurlResult` in, the render model out. */
export function mapLinkPreview(r: UnfurlResult): LinkCard {
  if (!r.ok) return { ok: false, kind: r.kind ?? 'og', message: failMessage(r.reason, r.kind) }
  // A title with nothing else to show is still a preview; the SUB line is
  // whichever identity the kind actually carries — a channel/author for
  // YouTube and LinkedIn, the site for a generic OG card.
  const sub = r.kind === 'youtube' || r.kind === 'linkedin' ? r.author : r.site
  return {
    ok: true,
    kind: r.kind,
    title: r.title,
    sub: sub ?? null,
    image: r.image,
    ratio: r.kind === 'youtube' ? '16:9' : null,
  }
}
