// X ARTICLE MARKDOWN -> BLOCKS. A line-for-line port of the publisher
// (claude-code-railway runner/lanes/x-article/lane.mjs `inline` + `toContentState`),
// so the review preview shows exactly the blocks X will receive. Change one, change both.
//
// One block per non-empty line. `## `/`# ` h2, `### ` h3, `- `/`* ` bullet, `1. ` numbered,
// `> ` quote, `{{IMAGE:n}}` alone on a line = that slot's image (skipped without a url),
// everything else a paragraph. Inline: `**bold**` and `[text](https://url)`. Headings drop `**`.

export type XInlineStyle = { offset: number; length: number; style: 'bold' }
export type XInlineLink = { offset: number; length: number; url: string }
export type XInline = { text: string; styles: XInlineStyle[]; links: XInlineLink[] }

export type XBlockType = 'unstyled' | 'header-two' | 'header-three' | 'unordered-list-item' | 'ordered-list-item' | 'blockquote' | 'atomic'

export type XBlock = XInline & {
  type: XBlockType
  /** Index of the source line in body_md (for tap-to-edit). */
  line: number
  /** Atomic blocks only: the image the slot resolved to. */
  image?: { url: string; alt: string | null; slot: string }
}

export type XImageRef = { slot: number | string; url?: string | null; alt?: string | null }

export function inline(src: string): XInline {
  let out = '', i = 0, boldStart: number | null = null
  const styles: XInlineStyle[] = [], links: XInlineLink[] = []
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      if (boldStart === null) boldStart = out.length
      else { if (out.length > boldStart) styles.push({ offset: boldStart, length: out.length - boldStart, style: 'bold' }); boldStart = null }
      i += 2; continue
    }
    if (src[i] === '[') {
      const m = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(src.slice(i))
      if (m) { links.push({ offset: out.length, length: m[1].length, url: m[2] }); out += m[1]; i += m[0].length; continue }
    }
    out += src[i]; i++
  }
  return { text: out, styles, links }
}

export function xArticleBlocks(md: string, images: XImageRef[] | null | undefined): XBlock[] {
  const blocks: XBlock[] = []
  const imgs = images ?? []
  const lines = String(md ?? '').split('\n')
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    if (!line) continue
    const img = /^\{\{IMAGE:(\d+)\}\}$/.exec(line)
    if (img) {
      const im = imgs.find(x => String(x.slot) === img[1] && x.url)
      if (im) blocks.push({ type: 'atomic', text: ' ', styles: [], links: [], line: n, image: { url: String(im.url), alt: im.alt ?? null, slot: img[1] } })
      continue
    }
    let type: XBlockType = 'unstyled', body = line
    if (/^### /.test(line)) { type = 'header-three'; body = line.slice(4) }
    else if (/^## /.test(line)) { type = 'header-two'; body = line.slice(3) }
    else if (/^# /.test(line)) { type = 'header-two'; body = line.slice(2) }
    else if (/^[-*] /.test(line)) { type = 'unordered-list-item'; body = line.slice(2) }
    else if (/^\d+\. /.test(line)) { type = 'ordered-list-item'; body = line.replace(/^\d+\. /, '') }
    else if (/^> /.test(line)) { type = 'blockquote'; body = line.slice(2) }
    if (type.startsWith('header')) body = body.replace(/\*\*/g, '')
    blocks.push({ type, line: n, ...inline(body) })
  }
  return blocks
}

export type XSpan = { text: string; bold: boolean; url: string | null }

/** Cut a block's text at every style and link edge, so each run is one plain/bold/link piece. */
export function spans(b: XInline): XSpan[] {
  const cuts = new Set<number>([0, b.text.length])
  for (const r of [...b.styles, ...b.links]) { cuts.add(r.offset); cuts.add(r.offset + r.length) }
  const at = [...cuts].filter(x => x >= 0 && x <= b.text.length).sort((a, z) => a - z)
  const out: XSpan[] = []
  for (let i = 0; i + 1 < at.length; i++) {
    const s = at[i], e = at[i + 1]
    if (e <= s) continue
    const bold = b.styles.some(r => r.offset <= s && r.offset + r.length >= e)
    const link = b.links.find(r => r.offset <= s && r.offset + r.length >= e)
    out.push({ text: b.text.slice(s, e), bold, url: link?.url ?? null })
  }
  return out
}

/** Word count the way qa.words counts it (whitespace split of the raw markdown). */
export function wordCount(md: string): number {
  return String(md ?? '').split(/\s+/).filter(Boolean).length
}
