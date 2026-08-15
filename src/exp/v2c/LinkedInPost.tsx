import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ContentLane } from '../../lib/content'

// The LinkedIn-faithful post preview — and, in this app, THE EDITOR.
//
// Ivan, 2026-08-03: "the content window when open each post to see is nothing
// like dashboard-v2/?section=posts&sub=pipeline with the html preview editable
// and way better horizontal organization".
//
// STRUCTURE ported from personal-site/components/dashboard-v2/review/
// reviewShared.tsx (`LinkedInPost`): white card, 10px radius, 48px round avatar,
// name · 1st, headline, "now · 🌐", 15px/1.6 body at rgba(0,0,0,.9) with
// pre-wrap, full-bleed image on #f3f2ef, reaction row, Like/Comment/Repost/Send.
// The reference deliberately shows the body IN FULL with no line clamp ("the
// whole point is reading the draft") and that rule is kept.
//
// WHAT IS NOT PORTED, deliberately:
//  · lucide-react. The five glyphs are drawn as inline SVG here — the run's
//    non-negotiables forbid a new dependency, and five paths is not a reason
//    for one.
//  · the hardcoded author. The reference is Ivan-only; this app renders two
//    lanes, so the identity comes from the lane and Mattan's row never depicts
//    Ivan's face. The portrait is the live asset off ivanmanfredi.com with an
//    initials fallback, so a 404 degrades to a monogram rather than a broken
//    image icon.
//
// WHAT IS BETTER THAN THE REFERENCE: there, `e` REPLACES the preview with a
// 16-row textarea — you edit a different object from the one you were reading.
// Here the body element itself becomes the field: same font, same size, same
// line-height, same box, inside the same card, under the same avatar. Nothing
// moves when you start typing, which is the literal reading of "the html
// preview editable".

const LI_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

const AUTHOR: Record<ContentLane, { name: string; headline: string; initials: string; photo: string | null }> = {
  ivan: {
    name: 'Iván Manfredi',
    headline: 'AI content systems for agencies',
    initials: 'IM',
    photo: 'https://ivanmanfredi.com/ivan-portrait-400.webp',
  },
  risedtc: {
    // No portrait asset exists for this lane in either repo, so it draws a
    // monogram rather than borrowing a face.
    name: 'Mattan Danino',
    headline: 'Founder, RISE DTC',
    initials: 'MD',
    photo: null,
  },
  arch: {
    name: 'Davorin Smit',
    headline: 'Founder, ARCH. Influencer Agency',
    initials: 'DS',
    photo: null,
  },
}

function Avatar({ lane }: { lane: ContentLane }) {
  const a = AUTHOR[lane]
  const ref = useRef<HTMLImageElement>(null)
  if (!a.photo) {
    return <span className="li-av li-av-mono" aria-hidden>{a.initials}</span>
  }
  return (
    <>
      <img
        ref={ref}
        className="li-av"
        src={a.photo}
        alt=""
        onError={e => {
          // Swap to the monogram in place — a broken-image glyph inside a
          // "this is what it will look like" preview is a lie about the render.
          const el = e.currentTarget
          el.style.display = 'none'
          el.nextElementSibling?.classList.remove('li-av-hide')
        }}
      />
      <span className="li-av li-av-mono li-av-hide" aria-hidden>{a.initials}</span>
    </>
  )
}

// LinkedIn tints hashtags and links. Read mode shows that; edit mode is plain
// text, because the stored post_body IS plain text and a rich editor would
// invent markup the publisher never sends.
const TOKEN_RE = /(#[\p{L}\p{N}_]+|@[\p{L}\p{N}._-]+|(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?)/giu

export function tintTokens(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<span className="li-tok" key={`t${key++}`}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// ---- the five glyphs, drawn (see header note on lucide) --------------------

const S = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const Glyph = {
  globe: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  like: <svg {...S} aria-hidden><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>,
  comment: <svg {...S} aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  repost: <svg {...S} aria-hidden><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>,
  send: <svg {...S} aria-hidden><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>,
}

const REACTIONS = [
  { bg: '#378fe9', ch: null },
  { bg: '#df704d', ch: '❤' },
  { bg: '#f5bb5c', ch: '💡' },
]

const BAR: [keyof typeof Glyph, string][] = [
  ['like', 'Like'], ['comment', 'Comment'], ['repost', 'Repost'], ['send', 'Send'],
]

export function LinkedInPost({ lane, text, image, editing, value, onChange, onStartEdit, onCancel, onSave, busy, footer }: {
  lane: ContentLane
  /** The saved body — what is stored, shown when not editing. */
  text: string
  image?: string | null
  editing: boolean
  /** The working copy while editing. */
  value: string
  onChange: (v: string) => void
  /** Absent = the body is not editable on this lane/row and never invites a click. */
  onStartEdit: (() => void) | null
  onCancel: () => void
  onSave: () => void
  busy: boolean
  /** Rendered inside the card between the body and the reaction row. */
  footer?: ReactNode
}) {
  const a = AUTHOR[lane]
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Grow to the content so the card's height is the post's height — a scrollbar
  // inside the body would break the "as it will appear" claim.
  useLayoutEffect(() => {
    if (!editing) return
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, value])

  // Focus the field and put the caret at the end, not at 0 — the common intent
  // is to keep writing, and a caret at the top of a 2,000-character post is a
  // scroll to nowhere.
  useEffect(() => {
    if (!editing) return
    const el = taRef.current
    if (!el) return
    el.focus()
    const n = el.value.length
    try { el.setSelectionRange(n, n) } catch { /* not all engines allow it */ }
  }, [editing])

  return (
    <div className="li-card" style={{ fontFamily: LI_SANS }}>
      <div className="li-top">
        <div className="li-head">
          <Avatar lane={lane} />
          <div className="li-who">
            <div className="li-name">{a.name} <span className="li-deg">· 1st</span></div>
            <div className="li-hl">{a.headline}</div>
            <div className="li-when">now · {Glyph.globe}</div>
          </div>
        </div>

        {editing ? (
          <textarea
            ref={taRef}
            className="li-body li-ta"
            value={value}
            disabled={busy}
            spellCheck
            aria-label="Post body"
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              // Esc cancels (the reference's rule). ⌘/Ctrl-Enter saves, because
              // an explicit save that needs a mouse is not an editor.
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave() }
            }}
          />
        ) : (
          <div
            className={`li-body${onStartEdit ? ' li-body-edit' : ''}`}
            onClick={onStartEdit ?? undefined}
            role={onStartEdit ? 'button' : undefined}
            tabIndex={onStartEdit ? 0 : undefined}
            onKeyDown={onStartEdit ? e => { if (e.key === 'Enter') { e.preventDefault(); onStartEdit() } } : undefined}
            title={onStartEdit ? 'Click to edit the copy in place' : undefined}
          >
            {text ? tintTokens(text) : <span className="li-empty">(no body yet)</span>}
          </div>
        )}
        {footer}
      </div>

      {image && !editing && (
        <div className="li-media"><img src={image} alt="" loading="lazy" /></div>
      )}

      <div className="li-foot">
        <div className="li-reacts">
          <span className="li-rs">
            {REACTIONS.map((r, i) => (
              <span className="li-r" style={{ background: r.bg, marginLeft: i ? -5 : 0 }} key={i}>
                {r.ch ?? <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff" aria-hidden><path d="M7 10v12h10.5a2 2 0 0 0 1.92-1.44l2.33-8A2 2 0 0 0 19.83 10H14l1-4.12A3.13 3.13 0 0 0 12 2L8.55 8.89A2 2 0 0 1 6.76 10H7Z" /></svg>}
              </span>
            ))}
          </span>
        </div>
        <div className="li-bar">
          {BAR.map(([g, label]) => (
            <span className="li-act" key={label}>{Glyph[g]} {label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
