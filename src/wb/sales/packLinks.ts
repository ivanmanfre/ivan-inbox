// A published call sheet is a page written on the Mac, and its links point at
// sibling FILES (`sales-deck.html`). Inside the inbox those files do not exist,
// so each relative link is either re-pointed at the document it names or, when
// there is no such document, turned into plain text. Absolute links, mail and
// phone links and in-page anchors are left alone.
import type { PackKind } from '../../lib/salesPacks'

const FILE_KIND: Record<string, PackKind> = {
  'sales-deck.html': 'deck',
  'sales-script.html': 'call_sheet',
  'audience-audit.html': 'audience_audit',
}

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

/** `hrefFor` must give an absolute address into the app: a frame's own base is not the app's. */
export function rewritePackLinks(html: string, have: ReadonlySet<string>, hrefFor: (kind: PackKind) => string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (!href || ABSOLUTE.test(href)) continue
    const file = href.split(/[?#]/)[0].split('/').pop()!.toLowerCase()
    const kind = FILE_KIND[file]
    if (kind && have.has(kind)) {
      a.setAttribute('href', hrefFor(kind))
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    } else {
      const span = doc.createElement('span')
      while (a.firstChild) span.appendChild(a.firstChild)
      a.replaceWith(span)
    }
  }
  return '<!doctype html>' + doc.documentElement.outerHTML
}
