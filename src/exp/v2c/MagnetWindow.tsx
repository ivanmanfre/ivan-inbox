import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useResourceDetail } from '../../hooks/useContent'
import { useSectionState } from '../../hooks/useSectionState'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  LANE_LABEL, normalizeAgentLog, normalizeImageUrls, normalizeQa, selfContainedHtml,
  type ContentLane,
} from '../../lib/content'
import { LM_STAGE_LABEL, stageOfLm, type ResourceDetail } from '../../lib/styles'
import { label } from '../../lib/labels'
import { Block, Rows, Val } from './ContentBits'
import { AgentRegister, QaRegister } from './Register'
import { HtmlPreview, Takeover } from './Takeover'
import { LinkedInPost } from './LinkedInPost'
import { absTime, relTime } from './fmt'
import { Failed } from './Surface'
import { appendAgentNote, regenLmContent, regenLmCover, saveLmField } from '../../lib/studioActions'
import type { QueueItem } from './DraftPane'

// A lead-magnet row (lm_drafts_v2), in the SAME three-column reader as a content
// draft — the goal's ask 5: "Lead magnets get the same treatment from
// LmWorkSurface.tsx + LeadMagnetEditor.tsx".
//
//   01 QUEUE  |  02 THE ARTIFACT                |  03 THE EVIDENCE
//   the rows  |  the promo post (editable) +    |  QA verdict, the landing
//   j/k walks |  the cover + the live links     |  artifact, live URLs, the
//             |  + the decision bar             |  register, fields
//
// WHAT STAYS READ-ONLY, and why it is not an oversight: nothing here writes
// `lm_drafts_v2.status` to 'approved'. Whether an n8n watcher treats that value
// as a publish trigger is unverifiable from this repo, so an Approve button
// might turn out to publish a page. The reference's LmWorkSurface `a` key is
// `Approve & build assets` — a real pipeline fire — and that is precisely the
// thing this app must not offer blind. `regenLmContent` DOES write
// status='generating', which is the reverse direction (it takes a row OUT of
// reviewable) and is the same write the old dashboard makes.

function textBlock(label: string, v: string | null | undefined): ReactNode {
  const s = (v ?? '').trim()
  if (!s) return null
  return (
    <Block label={label}>
      <div className="dd-card"><div className="dd-body dd-pre">{s}</div></div>
    </Block>
  )
}

function Sec({ k, label, tail, open, toggle, children }: {
  k: string; label: string; tail?: ReactNode
  open: string[]; toggle: (k: string) => void; children: ReactNode
}) {
  const on = open.includes(k)
  return (
    <div className={`dw-sec${on ? ' on' : ''}`}>
      <button type="button" className="dw-sec-b" onClick={() => toggle(k)} aria-expanded={on}>
        <span className="dw-sec-n">{label}</span>
        {tail && <span className="dw-sec-t">{tail}</span>}
        <span className="dw-sec-c" aria-hidden>›</span>
      </button>
      {on && <div className="dw-sec-body">{children}</div>}
    </div>
  )
}

function QueueRail({ queue, id, onPick }: {
  queue: QueueItem[]; id: string; onPick: (id: string) => void
}) {
  const at = queue.findIndex(q => q.id === id)
  const ref = useRef<HTMLDivElement>(null)
  // Keep the current row in view when j/k walks past the fold — but ONLY when
  // the rail is its own scroller. Below 1180 the rail is the LAST block of the
  // window's single scroller, and scrollIntoView walks every ancestor: it
  // dragged the whole window down past the post to show a queue row nobody had
  // asked for. Measured on the 390 shot before this guard.
  useEffect(() => {
    const el = ref.current
    if (!el || el.scrollHeight <= el.clientHeight) return
    el.querySelector('.dw-qrow.on')?.scrollIntoView({ block: 'nearest' })
  }, [id])
  return (
    <aside className="dw-queue" ref={ref}>
      <div className="dw-queue-h">
        <span>In this queue</span>
        <b>{at >= 0 ? at + 1 : '–'}/{queue.length}</b>
      </div>
      {queue.map(q => (
        <button type="button" key={q.id} className={`dw-qrow${q.id === id ? ' on' : ''}`}
          onClick={() => onPick(q.id)}>
          <div className="dw-qrow-t">{q.title || 'Untitled'}</div>
          <div className="dw-qrow-m">{q.type ?? 'Lead magnet'} · {relTime(q.updated_at)}</div>
        </button>
      ))}
    </aside>
  )
}

// The lead-magnet ACTIONS. Both hit the same n8n webhooks the old dashboard
// hits — lm-regen-cover-v2 and lm-gen-v2 — probed from this origin before
// shipping (OPTIONS returns allow-methods OPTIONS, POST for this app's origin).
//
// Both cost real money and real time, so both confirm, and each says what it
// touches: the cover regen writes cover_url and NOTHING else (the engine's own
// guarantee, which is why it is safe on a reviewed body), while a content regen
// replaces the written body.
function LmActions({ d, hasCover, onDone }: {
  d: { id: string; topic?: string | null; format?: string | null }
  hasCover: boolean
  onDone: () => void
}) {
  const [asking, setAsking] = useState<'cover' | 'content' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const run = async (what: 'cover' | 'content') => {
    setBusy(true); setErr(''); setNote('')
    try {
      if (what === 'cover') {
        await regenLmCover(d.id)
        setNote('Cover regeneration started — it replaces the image in place, so it appears here on the next refresh.')
      } else {
        await regenLmContent(d)
        setNote('Content regeneration started. The row sits in Generating until the run lands.')
      }
      setAsking(null)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start it')
    } finally { setBusy(false) }
  }

  return (
    <div className="wb-delzone">
      {err && <div className="ops-err">{err}</div>}
      {note && <div className="ct-subtle">{note}</div>}
      {asking === null ? (
        <div className="ct-ac">
          <button type="button" className="wb-editbtn" onClick={() => setAsking('cover')}>
            {hasCover ? 'Regen cover' : 'Generate cover'}
          </button>
          <button type="button" className="wb-editbtn" onClick={() => setAsking('content')}>
            Regen content
          </button>
        </div>
      ) : (
        <div className="wb-delconfirm">
          <span className="wb-delq">
            {asking === 'cover'
              ? 'Regenerate the cover image? It costs a paid image generation and takes a couple of minutes. It writes the cover only — the body is untouched.'
              : 'Regenerate the written content? This replaces the body, email copy and resource for this lead magnet. The run takes around ten minutes.'}
          </span>
          <div className="ct-ac">
            <button type="button" className="btn s" disabled={busy} onClick={() => setAsking(null)}>Cancel</button>
            <button type="button" className="btn p" disabled={busy} onClick={() => run(asking)}>
              {busy ? 'Starting…' : asking === 'cover' ? 'Regenerate cover' : 'Regenerate content'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// An editable text field on the LM row — the reference's LeadMagnetEditor
// `Save changes`, split per field so a save says which words it wrote. Explicit
// save, verified write, and never a status write.
function LmField({ id, label, field, value, hint, onDone }: {
  id: string
  label: string
  field: 'post_body' | 'email_copy'
  value: string
  hint?: string
  onDone: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (!editing) { setShown(value); setText(value) } }, [value, editing])

  const save = async () => {
    setBusy(true); setErr('')
    try {
      await saveLmField(id, field, text)
      setShown(text)
      setEditing(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2600)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }

  if (!shown && !editing) {
    return (
      <Block label={label}>
        <div className="wb-delzone">
          <button type="button" className="wb-editbtn" onClick={() => { setText(''); setEditing(true) }}>
            Write it
          </button>
        </div>
      </Block>
    )
  }

  return (
    <Block label={label} tail={!editing
      ? (
        <>
          {saved && <span className="wb-savestate ok">Saved</span>}
          <button type="button" className="wb-editbtn" onClick={() => { setText(shown); setEditing(true) }}>
            Edit
          </button>
        </>
      )
      : undefined}>
      {hint && !editing && <div className="ct-subtle">{hint}</div>}
      {editing ? (
        <div className="dd-card wb-editcard">
          {err && <div className="wb-savestate bad wb-savestate-row">{err}</div>}
          <textarea className="wb-edit-ta" value={text} disabled={busy} autoFocus
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false); setText(shown) }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
            }} />
          <div className="ct-ac">
            <button type="button" className="btn s" disabled={busy}
              onClick={() => { setEditing(false); setText(shown); setErr('') }}>Cancel</button>
            <button type="button" className="btn p" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dd-card"><div className="dd-body dd-pre">{shown}</div></div>
      )}
    </Block>
  )
}

function NoteComposer({ id, onDone }: { id: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => {
    const body = text.trim()
    if (!body) return
    setBusy(true); setErr('')
    try {
      await appendAgentNote('lm_drafts_v2', id, body)
      setText('')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the note')
    } finally { setBusy(false) }
  }
  return (
    <div className="dw-note">
      {err && <div className="ops-err">{err}</div>}
      <textarea value={text} placeholder="Add a note for future-you (⌘↵ to post)…"
        aria-label="Add a note to the generation register"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
      <div className="ct-ac">
        <button type="button" className="btn p" disabled={busy || !text.trim()} onClick={send}>
          {busy ? 'Posting…' : 'Post note'}
        </button>
      </div>
    </div>
  )
}

function Body({ d, lane, queue, refresh, onPick }: {
  d: ResourceDetail
  lane: ContentLane
  queue: QueueItem[]
  refresh: () => void
  onPick: (id: string) => void
}) {
  const stage = stageOfLm(d)
  const log = normalizeAgentLog(d.agent_log)
  const qa = normalizeQa(d.qa)
  // `covers` is agent-written; the sane shape is an array of URLs, and
  // normalizeImageUrls already reads exactly that plus its string variants.
  const covers = normalizeImageUrls(d.covers)
  const heroImgs = covers.length > 0 ? covers : (d.cover_url ? [d.cover_url] : [])
  const artifact = (d.resource_html ?? '').trim()
  const confirm = useConfirm()

  const [sect, setSect] = useSectionState('magnets.window')
  const open = sect.open
  const toggle = useCallback((k: string) => {
    setSect(p => ({ ...p, open: p.open.includes(k) ? p.open.filter(x => x !== k) : [...p.open, k] }))
  }, [setSect])
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (sect.open.length === 0) setSect(p => ({ ...p, open: ['art'] }))
  }, [sect.open.length, setSect])

  const [more, setMore] = useState(false)
  const at = queue.findIndex(q => q.id === d.id)
  const next = at >= 0 && at + 1 < queue.length ? queue[at + 1].id : null
  const hasRail = queue.length > 1

  // The reference's LM keys, minus the two this app refuses to offer: `a`
  // (Approve & build assets) and `r` (reject) both write lm_drafts_v2.status,
  // which is the write whose consequence is unverifiable from here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      switch (e.key) {
        case 'j': e.preventDefault(); if (at >= 0 && at + 1 < queue.length) onPick(queue[at + 1].id); break
        case 'k': e.preventDefault(); if (at > 0) onPick(queue[at - 1].id); break
        case 's': e.preventDefault(); if (next) onPick(next); break
        case 'o': e.preventDefault(); setMore(m => !m); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at, queue, next, onPick])

  const links: [string, string | null][] = [
    ['Landing page', d.landing_url],
    ['Resource', d.resource_url],
    ['OG image', d.og_url],
    ['Video', d.video_url],
  ]
  const liveLinks = links.filter((l): l is [string, string] => !!(l[1] && l[1].trim()))

  const meta: [string, ReactNode][] = []
  if (d.landing_slug) meta.push(['Landing slug', d.landing_slug])
  if (d.slug) meta.push(['Slug', d.slug])
  if (d.vertical_slug) meta.push(['Vertical', d.vertical_slug])
  if (d.gate_keyword) meta.push(['Gate keyword', d.gate_keyword])
  if (d.source) meta.push(['Source', d.source])
  if (d.source_ref) meta.push(['Ref', d.source_ref])
  if (d.campaign_id) meta.push(['Campaign', d.campaign_id])
  if (d.workflow_file_id) meta.push(['Workflow file', d.workflow_file_id])

  const dates: [string, ReactNode][] = []
  if (d.created_at) dates.push(['Created', <>{relTime(d.created_at)} <span className="dd-abs">{absTime(d.created_at)}</span></>])
  if (d.updated_at) dates.push(['Updated', <>{relTime(d.updated_at)} <span className="dd-abs">{absTime(d.updated_at)}</span></>])

  const openLive = async (url: string) => {
    // A live URL is a public page. Opening one from a review window is harmless,
    // but saying so beats a surprise tab.
    const ok = await confirm({
      title: 'Open the live page?',
      message: 'This opens the published page in a new tab. Nothing is written.',
      confirmText: 'Open',
    })
    if (ok) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const main = (
    <div className="dw-main">
      <div className="dw-main-in">
        <div className="dw-cap">
          <div className="dw-cap-t">{d.topic ?? 'Untitled'}</div>
          {hasRail && at >= 0 && <span className="dw-pos">{at + 1} of {queue.length}</span>}
        </div>
        <div className="ct-meta" style={{ padding: '0 16px 4px' }}>
          {d.format && <span className="ct-chip">{d.format}</span>}
          <span className={`ct-chip${stage === 'error' ? ' ct-chip-bad' : ''}`}>{LM_STAGE_LABEL[stage]}</span>
          {d.updated_at && <span className="ct-chip">{relTime(d.updated_at)}</span>}
          {/* The raw DB value rides along when the fold changed it, so the
              legacy-vocabulary fold stays auditable from the window. */}
          {d.status && LM_STAGE_LABEL[stage].toLowerCase() !== d.status.toLowerCase() && (
            <span className="ct-ref">{label(d.status)}</span>
          )}
        </div>

        {/* The promo post is what a lead magnet SHIPS AS on the feed, so it gets
            the same faithful card — and the same in-place editing — as a draft. */}
        <LmPromo d={d} lane={lane} refresh={refresh} />

        {heroImgs.length > 0 && (
          <Block label={heroImgs.length === 1 ? 'Cover' : `Covers · ${heroImgs.length}`}>
            <div className="dd-imgs">
              {heroImgs.map((u, i) => <img className="dd-img" src={u} alt="" key={`${u}-${i}`} />)}
            </div>
          </Block>
        )}

        {more && (
          <LmActions d={d} hasCover={heroImgs.length > 0} onDone={refresh} />
        )}

        <div className="dw-acts">
          {liveLinks[0] && (
            <button type="button" className="dw-key" onClick={() => openLive(liveLinks[0][1])}>
              Open {liveLinks[0][0].toLowerCase()} ↗
            </button>
          )}
          {next && <button type="button" className="dw-key" onClick={() => onPick(next)}><kbd>s</kbd> Next</button>}
          <button type="button" className="dw-key" aria-expanded={more} onClick={() => setMore(m => !m)}>
            <kbd>o</kbd> {more ? 'Hide actions' : 'More actions'}
          </button>
          {hasRail && <span className="dw-hint"><kbd>j</kbd><kbd>k</kbd> move · <kbd>esc</kbd> close</span>}
        </div>
      </div>
    </div>
  )

  const insp = (
    <aside className="dw-insp">
      <div className="dw-insp-h">What decides it</div>

      {/* The landing-page artifact — what this lead magnet actually IS. Only a
          self-contained document earns the frame; a kit-CSS fragment would
          render as raw text (same rule as the draft window). */}
      <Sec k="art" label="Landing artifact"
        tail={selfContainedHtml(artifact) ? undefined : (liveLinks.length ? 'live only' : 'none')}
        open={open} toggle={toggle}>
        {selfContainedHtml(artifact) ? (
          <HtmlPreview html={artifact} title="Landing page artifact" />
        ) : (
          <div className="ct-subtle">
            {artifact
              ? 'The stored HTML is a fragment whose styles live in the render service, so framing it here would show raw text rather than the page. The live URL below is the honest render.'
              : 'No rendered artifact stored on this row.'}
          </div>
        )}
        {liveLinks.length > 0 ? (
          <Block label="Live">
            {liveLinks.map(([k, url]) => (
              <a className="dd-link" href={url} target="_blank" rel="noreferrer" key={k}>{k} ↗</a>
            ))}
          </Block>
        ) : (
          <div className="ct-subtle">No live URL on this row yet.</div>
        )}
      </Sec>

      {qa ? (
        <Sec k="qa" label="QA verdict" tail={qa.score !== null ? `${qa.score}` : qa.verdict ?? undefined}
          open={open} toggle={toggle}>
          <QaRegister qa={qa} />
        </Sec>
      ) : (
        <Sec k="qa" label="QA verdict" tail="none" open={open} toggle={toggle}>
          <div className="ct-subtle">No gate has scored this row.</div>
        </Sec>
      )}

      <Sec k="copy" label="Copy" open={open} toggle={toggle}>
        <LmField id={d.id} label="Email copy" field="email_copy" value={d.email_copy ?? ''}
          hint="The 24-hour follow-up." onDone={refresh} />
        {textBlock('Description', d.description)}
      </Sec>

      <Sec k="log" label="Generation register" tail={log.length ? `${log.length}` : 'note only'}
        open={open} toggle={toggle}>
        <AgentRegister log={log} />
        <NoteComposer id={d.id} onDone={refresh} />
      </Sec>

      <Sec k="meta" label="Dates &amp; fields" open={open} toggle={toggle}>
        {dates.length > 0 && <Block label="Dates"><Rows items={dates} /></Block>}
        {meta.length > 0 && <Block label="Fields"><Rows items={meta} /></Block>}
        {/* Agent-written shapes, rendered structurally — never as a JSX child. */}
        {d.landing_copy !== null && d.landing_copy !== undefined && (
          <Block label="Landing copy"><div className="dd-card"><div className="dd-row"><div className="dd-v"><Val v={d.landing_copy} /></div></div></div></Block>
        )}
        {d.spec !== null && d.spec !== undefined && (
          <Block label="Spec"><div className="dd-card"><div className="dd-row"><div className="dd-v"><Val v={d.spec} /></div></div></div></Block>
        )}
        {d.notes !== null && d.notes !== undefined && (
          <Block label="Notes"><div className="dd-card"><div className="dd-row"><div className="dd-v"><Val v={d.notes} /></div></div></div></Block>
        )}
        <div className="ct-subtle">
          No approve here. Whether an n8n watcher treats <code>status='approved'</code> as a publish
          trigger is not readable from this app, so the one status this window will not write is that
          one.
        </div>
      </Sec>
    </aside>
  )

  return (
    <div className="dw">
      <div className={`dw-cols${hasRail ? '' : ' dw-norail'}`}>
        {main}
        {insp}
        {hasRail && <QueueRail queue={queue} id={d.id} onPick={onPick} />}
      </div>
    </div>
  )
}

// The promo post, in the faithful card, editable in place — same component and
// same rules as the draft window's. Split out so its editor state resets with
// the row rather than persisting across a j/k move.
function LmPromo({ d, lane, refresh }: { d: ResourceDetail; lane: ContentLane; refresh: () => void }) {
  const value = d.post_body ?? ''
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (editing) return
    setShown(value)
    setText(value)
  }, [value, editing])

  const save = async () => {
    setBusy(true); setErr('')
    try {
      await saveLmField(d.id, 'post_body', text)
      setShown(text)
      setEditing(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2600)
      refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }

  return (
    <>
      <LinkedInPost
        lane={lane}
        text={shown}
        image={d.cover_url ?? null}
        editing={editing}
        value={text}
        onChange={setText}
        onStartEdit={editing ? null : () => { setText(shown); setEditing(true) }}
        onCancel={() => { setEditing(false); setText(shown) }}
        onSave={save}
        busy={busy}
        footer={editing ? (
          <div className="li-editbar">
            <button type="button" className="li-btn p" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="li-btn" disabled={busy}
              onClick={() => { setEditing(false); setText(shown) }}>Cancel</button>
            <span className="li-editnote">esc cancels · ⌘↵ saves</span>
          </div>
        ) : saved ? (
          <div className="li-editbar"><span className="li-saved">Saved to the database</span></div>
        ) : undefined}
      />
      {err && <div className="ops-err" style={{ margin: '10px 16px 0' }}>{err}</div>}
    </>
  )
}

export function MagnetWindow({ id, lane, queue, onClose, onPick, mobile }: {
  id: string
  lane: ContentLane
  queue: QueueItem[]
  onClose: () => void
  onPick: (id: string) => void
  mobile: boolean
}) {
  const [bump, setBump] = useState(0)
  const reload = useCallback(() => setBump(b => b + 1), [])
  const { detail, missing, loading, error } = useResourceDetail(id, bump)
  const sub = `${LANE_LABEL[lane]}${detail?.format ? ` · ${detail.format}` : ''}`


  return (
    <Takeover label="Lead magnet" sub={sub} onClose={onClose} mobile={mobile} bodyClass="dw-body">
      {error ? (
        <Failed what="This lead magnet" message={error} loadedAt={null} />
      ) : loading && !detail ? (
        <div aria-hidden style={{ padding: '18px 16px 0' }}>
          <div className="sk sk-line" style={{ width: '70%', height: 20 }} />
          <div className="sk sk-line" style={{ width: '40%', marginTop: 12 }} />
          <div className="sk" style={{ height: 220, borderRadius: 16, marginTop: 18 }} />
        </div>
      ) : missing || !detail ? (
        <div className="wb-empty">
          <div className="wb-empty-l">This lead magnet is no longer in the database.</div>
          <div className="wb-empty-s">It was removed while the lane was open.</div>
        </div>
      ) : (
        <Body key={detail.id} d={detail} lane={lane} queue={queue} refresh={reload} onPick={onPick} />
      )}
    </Takeover>
  )
}
