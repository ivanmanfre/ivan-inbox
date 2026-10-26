export type EmailRichNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: EmailRichNode[]
}

export type EmailComposition = {
  version: 1
  source_text: string
  body: EmailRichNode
  signature: EmailRichNode | null
}

const MAX_NODES = 2_000
const MAX_DEPTH = 24
const MAX_TEXT = 100_000
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const keysOnly = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const hasControl = (value: string, allowLineBreaks: boolean) => [...value].some(char => {
  const code = char.charCodeAt(0)
  return code === 127 || (code < 32 && (!allowLineBreaks || (code !== 9 && code !== 10 && code !== 13)))
})

/** Shared with the send boundary: never trust persisted document JSON or hrefs. */
export function validEmailHref(href: string): boolean {
  return /^(?:https?:\/\/[^\s<>"'`\\]+|mailto:[^\s<>"'`\\@]+@[^\s<>"'`\\@]+)$/i.test(href)
    && !hasControl(href, false)
}

export function renderEmailDocument(doc: EmailRichNode): { html: string; text: string } {
  let count = 0
  let textLength = 0

  function render(node: EmailRichNode, parent: 'root' | 'blocks' | 'inline' | 'list', depth: number): { html: string; text: string } {
    if (!node || typeof node !== 'object' || Array.isArray(node) || ++count > MAX_NODES || depth > MAX_DEPTH) throw new Error('Invalid email document')
    if (!keysOnly(node as Record<string, unknown>, ['type', 'text', 'attrs', 'marks', 'content']) || typeof node.type !== 'string') throw new Error('Invalid email node')
    const attrs = node.attrs ?? {}
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) throw new Error('Invalid email attributes')
    const children = node.content ?? []
    if (!Array.isArray(children)) throw new Error('Invalid email content')
    if (node.type !== 'text' && (node.text !== undefined || node.marks !== undefined)) throw new Error('Invalid email node content')
    if (node.type !== 'doc' && parent === 'root') throw new Error('Email document root required')

    const join = (kind: 'inline' | 'blocks' | 'list', separator: string) => {
      const rendered = children.map(child => render(child, kind, depth + 1))
      if (kind === 'inline') {
        let text = ''
        let linkedLabel = ''
        let linkedHref: string | null = null
        const finishLink = () => {
          if (linkedHref) text += linkedLabel + (linkedLabel === linkedHref ? '' : ` (${linkedHref})`)
          linkedLabel = ''
          linkedHref = null
        }
        children.forEach((child, index) => {
          const href = child.marks?.find(mark => mark.type === 'link')?.attrs?.href
          const nextHref = typeof href === 'string' ? href : null
          if (nextHref !== linkedHref) finishLink()
          if (nextHref) { linkedHref = nextHref; linkedLabel += rendered[index].text }
          else text += rendered[index].text
        })
        finishLink()
        return { html: rendered.map(item => item.html).join(''), text }
      }
      return { html: rendered.map(item => item.html).join(''), text: rendered.map(item => item.text).join(separator) }
    }

    switch (node.type) {
      case 'doc': {
        if (parent !== 'root' || !keysOnly(attrs, []) || node.content === undefined) throw new Error('Invalid email root')
        return join('blocks', '\n\n')
      }
      case 'paragraph': {
        if (parent !== 'blocks' || !keysOnly(attrs, [])) throw new Error('Invalid email paragraph')
        const inner = join('inline', '')
        return { html: `<p style="margin:0 0 12px">${inner.html || '&nbsp;'}</p>`, text: inner.text }
      }
      case 'text': {
        if (parent !== 'inline' || typeof node.text !== 'string' || node.content !== undefined || !keysOnly(attrs, [])) throw new Error('Invalid email text')
        textLength += node.text.length
        if (textLength > MAX_TEXT || hasControl(node.text, true)) throw new Error('Email text too large or invalid')
        let html = escapeHtml(node.text)
        if (node.marks !== undefined && !Array.isArray(node.marks)) throw new Error('Invalid email marks')
        for (const mark of node.marks ?? []) {
          if (!mark || typeof mark !== 'object' || Array.isArray(mark) || !keysOnly(mark as Record<string, unknown>, ['type', 'attrs'])) throw new Error('Invalid email mark')
          const markAttrs = mark.attrs ?? {}
          if (!markAttrs || typeof markAttrs !== 'object' || Array.isArray(markAttrs)) throw new Error('Invalid email mark attributes')
          if (mark.type === 'link') {
            if (!keysOnly(markAttrs, ['href', 'target', 'rel', 'class']) || typeof markAttrs.href !== 'string' || !validEmailHref(markAttrs.href)) throw new Error('Unsafe email link')
            html = `<a href="${escapeHtml(markAttrs.href)}" style="color:#1a73e8;text-decoration:underline">${html}</a>`
          } else {
            if (!keysOnly(markAttrs, [])) throw new Error('Invalid email mark attributes')
            const tag = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' }[mark.type]
            if (!tag) throw new Error('Unsupported email mark')
            html = `<${tag}>${html}</${tag}>`
          }
        }
        return { html, text: node.text }
      }
      case 'hardBreak':
        if (parent !== 'inline' || !keysOnly(attrs, []) || node.content !== undefined) throw new Error('Invalid email break')
        return { html: '<br>', text: '\n' }
      case 'bulletList':
      case 'orderedList': {
        if (parent !== 'blocks' || node.content === undefined || !children.length) throw new Error('Invalid email list')
        if (node.type === 'bulletList' ? !keysOnly(attrs, []) : !keysOnly(attrs, ['start'])) throw new Error('Invalid email list attributes')
        const start = node.type === 'orderedList' ? (attrs.start ?? 1) : 1
        if (!Number.isInteger(start) || (start as number) < 1 || (start as number) > 1000) throw new Error('Invalid list start')
        const items = children.map(child => render(child, 'list', depth + 1))
        const ordered = node.type === 'orderedList'
        const tag = ordered ? 'ol' : 'ul'
        const listStyle = ordered ? 'decimal' : 'disc'
        const startAttr = ordered && start !== 1 ? ` start="${start}"` : ''
        return { html: `<${tag}${startAttr} style="margin:0 0 12px;padding-left:24px;list-style-type:${listStyle}">${items.map(item => item.html).join('')}</${tag}>`,
          text: items.map((item, index) => `${ordered ? `${(start as number) + index}.` : '-'} ${item.text.replace(/\n/g, '\n  ')}`).join('\n') }
      }
      case 'listItem': {
        if (parent !== 'list' || !keysOnly(attrs, []) || node.content === undefined || !children.length) throw new Error('Invalid email list item')
        const inner = join('blocks', '\n')
        return { html: `<li>${inner.html}</li>`, text: inner.text }
      }
      case 'blockquote': {
        if (parent !== 'blocks' || !keysOnly(attrs, []) || node.content === undefined || !children.length) throw new Error('Invalid email quote')
        const inner = join('blocks', '\n\n')
        return { html: `<blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #dadce0;color:#5f6368">${inner.html}</blockquote>`, text: inner.text.split('\n').map(line => `> ${line}`).join('\n') }
      }
      default: throw new Error('Unsupported email node')
    }
  }

  return render(doc, 'root', 0)
}

export function renderEmailComposition(composition: EmailComposition): { html: string; text: string } {
  if (!composition || composition.version !== 1 || typeof composition.source_text !== 'string' || composition.source_text.length > MAX_TEXT || hasControl(composition.source_text, true)) throw new Error('Invalid email composition')
  const body = renderEmailDocument(composition.body)
  const signature = composition.signature === null ? null : renderEmailDocument(composition.signature)
  return {
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#202124">${body.html}${signature ? `<div style="margin-top:24px">${signature.html}</div>` : ''}</div>`,
    text: body.text + (signature ? `\n\n${signature.text}` : ''),
  }
}

function autolinkLine(line: string): EmailRichNode[] {
  const nodes: EmailRichNode[] = []
  const url = /https?:\/\/[^\s<>"'`]+/gi
  let position = 0
  for (const match of line.matchAll(url)) {
    const index = match.index
    if (index > position) nodes.push({ type: 'text', text: line.slice(position, index) })
    let href = match[0].replace(/[.,!?;:]+$/, '')
    while (href.endsWith(')') && (href.match(/\)/g)?.length ?? 0) > (href.match(/\(/g)?.length ?? 0)) href = href.slice(0, -1)
    if (validEmailHref(href)) nodes.push({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
    else nodes.push({ type: 'text', text: href })
    position = index + href.length
  }
  if (position < line.length) nodes.push({ type: 'text', text: line.slice(position) })
  return nodes
}

export function plainEmailDocument(text: string): EmailRichNode {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/).map(block => ({
    type: 'paragraph',
    content: block.split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...autolinkLine(line)]),
  }))
  return { type: 'doc', content: blocks }
}

const SIGNERS = {
  'davorin@madebyarch.com': { name: 'Davorin Šmit', first: 'Davorin', company: 'ARCH', url: 'https://arch.agency', domain: 'arch.agency' },
  'itsmattan@risedtc.com': { name: 'Mattan Danino', first: 'Mattan', company: 'RISE', url: 'https://risedtc.com', domain: 'risedtc.com' },
} as const

function signer(from: string) {
  const address = (from.match(/<([^<>]+)>/)?.[1] ?? from).trim().toLowerCase()
  return SIGNERS[address as keyof typeof SIGNERS] ?? null
}

export function defaultEmailSignature(from: string): EmailRichNode | null {
  const cfg = signer(from)
  if (!cfg) return null
  return { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: cfg.name, marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: cfg.company }, { type: 'hardBreak' }, { type: 'text', text: cfg.domain, marks: [{ type: 'link', attrs: { href: cfg.url } }] }] },
  ] }
}

export function stripLegacyEmailSignature(body: string, from: string): string {
  const cfg = signer(from)
  if (!cfg) return body
  const lines = body.trimEnd().split(/\r?\n/)
  const popBlank = () => { while (lines.length && !lines[lines.length - 1].trim()) lines.pop() }
  const last = () => lines[lines.length - 1]?.trim() ?? ''
  const domain = cfg.domain.replace(/\./g, '\\.')
  const site = new RegExp('^(?:https?:\\/\\/)?(?:www\\.)?' + domain + '\\/?$', 'i')
  let hasSite = false
  if (site.test(last())) { lines.pop(); popBlank(); hasSite = true }
  const company = cfg.company === 'RISE' ? /^RISE(?: DTC)?$/i : /^ARCH$/i
  let hasCompany = false
  if (company.test(last())) { lines.pop(); popBlank(); hasCompany = true }
  const names = cfg.first === 'Davorin' ? /^(?:Davorin|Davorin (?:Šmit|Smit))$/i : /^(?:Mattan|Mattan Danino)$/i
  if ((!hasCompany && !hasSite) || !names.test(last())) return body
  lines.pop()
  popBlank()
  if (/^(?:Cheers|Best|Best regards|Regards|Thanks)[,!]?$/i.test(last())) { lines.pop(); popBlank() }
  return lines.join('\n').trimEnd()
}
