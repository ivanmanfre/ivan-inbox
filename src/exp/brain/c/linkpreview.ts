// linkpreview.ts — pure mapping from an unfurl() result to what a link-preview
// card renders. Kept separate from the component so the per-kind field choices
// (a YouTube card reads `author` as the channel, an OG card reads `site`) are
// asserted without mounting anything.
import type { UnfurlResult } from '../../../lib/unfurl'

export type LinkCardModel = {
  kind: 'youtube' | 'linkedin' | 'instagram' | 'og' | 'blocked'
  title: string
  /** Channel, author or site — whichever the source actually has. */
  subtitle: string | null
  image: string | null
  ratio: '16:9' | 'square' | null
}

/**
 * Instagram's honest-failure card ("Instagram gave nothing back") is its own
 * named state rather than the generic "no preview" line — the spec calls it out
 * by name because Instagram is the one source that regularly refuses a
 * logged-out fetch, and saying so is more honest than a blank card.
 */
export function mapLinkPreview(r: UnfurlResult): LinkCardModel {
  if (!r.ok) {
    if (r.kind === 'instagram') {
      return { kind: 'blocked', title: 'Instagram gave nothing back', subtitle: null, image: null, ratio: null }
    }
    return { kind: 'blocked', title: 'No preview available', subtitle: null, image: null, ratio: null }
  }
  if (r.kind === 'youtube') {
    return { kind: 'youtube', title: r.title, subtitle: r.author, image: r.image, ratio: '16:9' }
  }
  if (r.kind === 'linkedin') {
    return { kind: 'linkedin', title: r.title, subtitle: r.author, image: r.image, ratio: null }
  }
  if (r.kind === 'instagram') {
    return { kind: 'instagram', title: r.title, subtitle: r.author, image: r.image, ratio: 'square' }
  }
  return { kind: 'og', title: r.title, subtitle: r.site, image: r.image, ratio: null }
}
