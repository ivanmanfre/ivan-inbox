import { normalizeImageUrls, type ContentDraftDetail, type SaveConflict } from '../../lib/content'
import { Btn } from '../ui/Key'
import { warsawDayTime } from '../ui/time'
import { imgOf, type Lane } from './model'

// The LinkedIn-faithful preview: the platform's own light card at its own
// measure, because widening it would make the preview lie. While editing, the
// same card becomes the editor (lime outline). A save conflict shows the
// database's text and two named outcomes; nothing is written until one is picked.
const AUTHOR: Record<Lane, [string, string, string]> = {
  ivan: ['Iván Manfredi', 'AI content systems for agencies', 'IM'],
  risedtc: ['Mattan Danino', 'Rise DTC', 'MD'],
  arch: ['Davorin Smit', 'Arch', 'DS'],
}

export function Preview({ d, lane, body, editing, text, setText, onStartEdit, onCancel, onSave }: {
  d: ContentDraftDetail; lane: Lane; body: string; editing: boolean; text: string; setText: (s: string) => void
  /** Click on the post (or Enter) opens the editor, as today; null where the copy is not editable. */
  onStartEdit?: (() => void) | null; onCancel?: () => void; onSave?: () => void
}) {
  const [name, line, ini] = AUTHOR[lane]
  const img = d.type !== 'carousel' ? imgOf(d.image_urls) : null
  const all = normalizeImageUrls(d.image_urls)
  const slides = d.type === 'carousel' ? all : all.slice(1)
  return (
    <div className="cn-li">
      <div className="cn-lih"><i>{ini}</i><div><b>{name}</b> <span>· 1st</span><small>{line}</small><small>now</small></div></div>
      {editing ? (
        <>
          <textarea className="cn-ed" aria-label="Post text" value={text} onChange={e => setText(e.target.value)} autoFocus
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel?.() }
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave?.() }
            }} />
          <small className="cn-edk">esc cancels · ⌘↵ saves</small>
        </>
      ) : (
        <div className={`cn-lib${onStartEdit ? ' cn-lib-ed' : ''}`} onClick={onStartEdit ?? undefined} title={onStartEdit ? 'Click to edit (Enter)' : undefined}>
          {body ? body.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>) : <span style={{ color: '#888' }}>No post text yet.</span>}
        </div>
      )}
      {img && !editing && <img className="cn-liimg" src={img} alt="" loading="lazy" />}
      {slides.length > 0 && !editing && (
        <div className="cn-slides" aria-label={d.type === 'carousel' ? `Carousel, ${slides.length} slides` : 'More images'}>
          {slides.map((u, i) => <img key={`${u}-${i}`} src={imgOf([u], 400) ?? u} alt="" loading="lazy" />)}
        </div>
      )}
    </div>
  )
}

export function Conflict({ c, onTheirs, onMine, onDismiss, busy }: { c: SaveConflict; onTheirs: () => void; onMine: () => void; onDismiss?: () => void; busy: boolean }) {
  if (c.kind === 'gone') {
    return (
      <div className="cn-conf" role="alert">
        <b>This draft was deleted while you were editing it.</b>
        <p>Nothing was written. Your text is still in the editor above; copy it if you want to keep it.</p>
        {onDismiss && <div className="cn-ia"><Btn verb="dismiss" onClick={onDismiss}>Dismiss</Btn></div>}
      </div>
    )
  }
  return (
    <div className="cn-conf" role="alert">
      <b>This draft changed in the database while you were editing it.</b>
      <p>Nothing was overwritten.{c.theirUpdatedAt ? ` The body was rewritten ${warsawDayTime(c.theirUpdatedAt)}.` : ''} Here is what it holds now, your version is still in the editor above.</p>
      <div className="cn-well">{c.theirs ?? ''}</div>
      <div className="cn-ia">
        <Btn verb="take-theirs" onClick={onTheirs} disabled={busy}>Take theirs, drop mine</Btn>
        <Btn primary verb="keep-mine" onClick={onMine} disabled={busy}>Keep mine, overwrite theirs</Btn>
      </div>
    </div>
  )
}
