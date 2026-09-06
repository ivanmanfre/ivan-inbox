/* ==========================================================================
   S17 — THE MAGNET WINDOW. A lead-magnet row in a three-pane reader.

   Copied from `src/exp/v2c/MagnetWindow.tsx`. Every hook, every write, every
   confirm sentence, every keyboard path (j k s o, and Escape's field guard in
   the shell) and every string is that file's; the view is rebuilt on `src/ds`
   and the winner's kit.

     01 QUEUE  |  02 THE ARTIFACT              |  03 THE EVIDENCE
     the rows  |  the promo post (editable) +  |  the landing artifact, QA,
     j/k walks |  the covers + the live links  |  the copy, the register, the
               |  + the action row             |  dates and fields

   WHAT STAYS READ-ONLY, and why it is not an oversight: nothing here writes
   the row's status to approved. Whether a watcher treats that value as a
   publish trigger is unverifiable from this repo, so an Approve button might
   turn out to publish a page. `regenLmContent` DOES write a generating status,
   which is the reverse direction (it takes a row OUT of reviewable) and is the
   same write the old dashboard makes.
   ========================================================================== */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useResourceDetail } from '../../hooks/useContent'
import { useSectionState } from '../../hooks/useSectionState'
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  LANE_LABEL, normalizeAgentLog, normalizeImageUrls, normalizeQa, selfContainedHtml,
  type ContentLane,
} from '../../lib/content'
import { LM_STAGE_LABEL, stageOfLm, type ResourceDetail } from '../../lib/styles'
import { label } from '../../lib/labels'
import { appendAgentNote, regenLmContent, regenLmCover, saveLmField } from '../../lib/studioActions'
import { AgentRegister, QaRegister } from '../draft/register'
import { LinkedInPost } from '../draft/LinkedInPost'
import { absTime, relTime } from '../../exp/v2c/fmt'
import {
  Banner, Button, Chip, EmptyState, Icon, Kbd, SkeletonRows, fadeT, spring,
} from '../../ds'
import { Group, KV, Row, Rows } from '../kit'
import { Failed } from '../content/parts'
import { Block, Prose, Val } from './bits'
import { HtmlPreview, Takeover } from './Takeover'
import './magnet.css'

/** Structurally the queue item the shell hands every reading window. Declared
    here rather than imported so this window does not depend on the draft
    window's module while both are being rebuilt. */
export type MagnetQueueItem = {
  id: string
  title: string
  type: string | null
  updated_at: string
  status: string
}

// ---------------------------------------------------------------------------
// 01 · The queue rail
// ---------------------------------------------------------------------------

function QueueRail({ queue, id, onPick }: {
  queue: MagnetQueueItem[]; id: string; onPick: (id: string) => void
}) {
  const at = queue.findIndex(q => q.id === id)
  const ref = useRef<HTMLDivElement>(null)
  // Keep the current row in view when j/k walks past the fold — but ONLY when
  // the rail is its own scroller. Below the two-column breakpoint the rail is
  // the LAST block of the window's single scroller, and scrollIntoView walks
  // every ancestor: it dragged the whole window down past the post to show a
  // queue row nobody had asked for.
  useEffect(() => {
    const el = ref.current
    if (!el || el.scrollHeight <= el.clientHeight) return
    el.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [id])
  return (
    <aside className="a-mg-queue" ref={ref}>
      <Group label="In this queue" tail={`${at >= 0 ? at + 1 : '–'}/${queue.length}`} stickyHead>
        <Rows>
          {queue.map(q => (
            <Row
              key={q.id}
              selected={q.id === id}
              onClick={() => onPick(q.id)}
              title={q.title || 'Untitled'}
              titleWrap
              meta={<>{q.type ?? 'Lead magnet'} · {relTime(q.updated_at)}</>}
            />
          ))}
        </Rows>
      </Group>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// The evidence disclosure
// ---------------------------------------------------------------------------

function Sec({ k, label: name, tail, open, toggle, children }: {
  k: string; label: string; tail?: ReactNode
  open: string[]; toggle: (k: string) => void; children: ReactNode
}) {
  const on = open.includes(k)
  return (
    <section className="a-mg-sec" data-on={on ? '' : undefined}>
      <button type="button" className="a-mg-sec-b" onClick={() => toggle(k)} aria-expanded={on}>
        <Icon name="disclose" size={16} />
        <span className="a-mg-sec-n">{name}</span>
        {tail && <span className="a-mg-sec-t">{tail}</span>}
      </button>
      <AnimatePresence initial={false}>
        {on && (
          <motion.div
            className="a-mg-sec-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: fadeT }}
            exit={{ opacity: 0, transition: fadeT }}
          >{children}</motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The two generation actions
// ---------------------------------------------------------------------------
//
// Both cost real money and real time, so both confirm, and each says what it
// touches: the cover regeneration writes the cover and NOTHING else (the
// generator's own guarantee, which is why it is safe on a reviewed body), while
// a content regeneration replaces the written body.
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
        setNote('Cover regeneration started. It replaces the image in place, so it appears here on the next refresh.')
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
    <div className="a-mg-actions">
      {err && <Banner tone="urgent" icon="error" title={err} />}
      {note && <Banner tone="clear" icon="check" title={note} />}
      {asking === null ? (
        <div className="a-mg-btnrow">
          <Button icon="refresh" onClick={() => setAsking('cover')}>
            {hasCover ? 'Regen cover' : 'Generate cover'}
          </Button>
          <Button icon="refresh" onClick={() => setAsking('content')}>Regen content</Button>
        </div>
      ) : (
        <div className="a-mg-ask">
          <span className="a-mg-askq">
            {asking === 'cover'
              ? 'Regenerate the cover image? It costs a paid image generation and takes a couple of minutes. It writes the cover only, the body is untouched.'
              : 'Regenerate the written content? This replaces the body, email copy and resource for this lead magnet. The run takes around ten minutes.'}
          </span>
          <div className="a-mg-btnrow">
            <Button variant="quiet" disabled={busy} onClick={() => setAsking(null)}>Cancel</Button>
            <Button variant="primary" busy={busy} disabled={busy} onClick={() => run(asking)}>
              {busy ? 'Starting…' : asking === 'cover' ? 'Regenerate cover' : 'Regenerate content'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// One editable text field on the row, split per field so a save says which
// words it wrote. Explicit save, verified write, and never a status write.
function LmField({ id, label: name, field, value, hint, onDone }: {
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
      <Block label={name}>
        <div className="a-mg-btnrow">
          <Button icon="edit" onClick={() => { setText(''); setEditing(true) }}>Write it</Button>
        </div>
      </Block>
    )
  }

  return (
    <Block
      label={name}
      tail={!editing
        ? (
          <span className="a-wrapline">
            {saved && <Chip tone="clear">Saved</Chip>}
            <Button size="sm" variant="quiet" icon="edit" onClick={() => { setText(shown); setEditing(true) }}>
              Edit
            </Button>
          </span>
        )
        : undefined}
    >
      {hint && !editing && <div className="a-ct-sub">{hint}</div>}
      {editing ? (
        <div className="a-mg-card">
          {err && <Banner tone="urgent" icon="error" title={err} />}
          <textarea
            className="ds-textarea a-mg-ta" value={text} disabled={busy} autoFocus
            aria-label={name}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false); setText(shown) }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save() }
            }}
          />
          <div className="a-mg-btnrow">
            <Button variant="quiet" disabled={busy}
              onClick={() => { setEditing(false); setText(shown); setErr('') }}>Cancel</Button>
            <Button variant="primary" busy={busy} disabled={busy} onClick={() => { void save() }}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        <Prose text={shown} />
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
    <div className="a-mg-note">
      {err && <Banner tone="urgent" icon="error" title={err} />}
      <textarea
        className="ds-textarea a-mg-ta" value={text}
        placeholder="Add a note for future-you…"
        aria-label="Add a note to the generation register"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
      />
      <div className="a-mg-btnrow">
        <Button variant="primary" busy={busy} disabled={busy || !text.trim()} onClick={() => { void send() }}>
          {busy ? 'Posting…' : 'Post note'}
        </Button>
        {/* The key hint the placeholder used to carry as two glyphs. A
            placeholder cannot hold a mark, so it moved out beside the control
            it describes. */}
        <span className="a-mg-hint">
          <Kbd><Icon name="cmd" size={16} /></Kbd><Kbd><Icon name="enter" size={16} /></Kbd> posts
        </span>
      </div>
    </div>
  )
}

// The promo post, in the faithful LinkedIn card, editable in place. Split out
// so its editor state resets with the row rather than persisting across a j/k
// move. The card itself is deliberately NOT on the design system: it depicts
// another product's surface, and drawing it in our own tokens would be a
// preview that lies about the render.
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
    <div className="a-mg-promo">
      <LinkedInPost
        lane={lane}
        text={shown}
        image={d.cover_url ?? null}
        editing={editing}
        value={text}
        onChange={setText}
        onStartEdit={editing ? null : () => { setText(shown); setEditing(true) }}
        onCancel={() => { setEditing(false); setText(shown) }}
        onSave={() => { void save() }}
        busy={busy}
        footer={editing ? (
          <div className="li-editbar">
            <button type="button" className="li-btn p" disabled={busy} onClick={() => { void save() }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="li-btn" disabled={busy}
              onClick={() => { setEditing(false); setText(shown) }}>Cancel</button>
            <span className="li-editnote">
              <Kbd>esc</Kbd> cancels ·{' '}
              <Kbd><Icon name="cmd" size={16} /></Kbd><Kbd><Icon name="enter" size={16} /></Kbd> saves
            </span>
          </div>
        ) : saved ? (
          <div className="li-editbar"><span className="li-saved">Saved to the database</span></div>
        ) : undefined}
      />
      {err && <Banner tone="urgent" icon="error" title={err} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

function MagnetBody({ d, lane, queue, refresh, onPick }: {
  d: ResourceDetail
  lane: ContentLane
  queue: MagnetQueueItem[]
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

  // The reference's keys, minus the two this app refuses to offer: approve and
  // reject both write the status whose consequence is unverifiable from here.
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

  const meta: [ReactNode, ReactNode][] = []
  if (d.landing_slug) meta.push(['Landing slug', d.landing_slug])
  if (d.slug) meta.push(['Slug', d.slug])
  if (d.vertical_slug) meta.push(['Vertical', d.vertical_slug])
  if (d.gate_keyword) meta.push(['Gate keyword', d.gate_keyword])
  if (d.source) meta.push(['Source', d.source])
  if (d.source_ref) meta.push(['Ref', d.source_ref])
  if (d.campaign_id) meta.push(['Campaign', d.campaign_id])
  if (d.workflow_file_id) meta.push(['Workflow file', d.workflow_file_id])

  const dates: [ReactNode, ReactNode][] = []
  if (d.created_at) dates.push(['Created', <>{relTime(d.created_at)} <span className="a-dim-2">{absTime(d.created_at)}</span></>])
  if (d.updated_at) dates.push(['Updated', <>{relTime(d.updated_at)} <span className="a-dim-2">{absTime(d.updated_at)}</span></>])

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
    <div className="a-mg-main">
      <div className="a-mg-cap">
        <h3 className="a-page-t">{d.topic ?? 'Untitled'}</h3>
        {hasRail && at >= 0 && <span className="a-dim a-mono">{at + 1} of {queue.length}</span>}
      </div>
      <div className="a-mg-chips">
        {d.format && <Chip tone="quiet">{d.format}</Chip>}
        <Chip tone={stage === 'error' ? 'urgent' : 'neutral'}>{LM_STAGE_LABEL[stage]}</Chip>
        {d.updated_at && <Chip tone="quiet">{relTime(d.updated_at)}</Chip>}
        {/* The raw stored value rides along when the fold changed it, so the
            legacy-vocabulary fold stays auditable from the window. */}
        {d.status && LM_STAGE_LABEL[stage].toLowerCase() !== d.status.toLowerCase() && (
          <span className="a-dim-2">{label(d.status)}</span>
        )}
      </div>

      {/* The promo post is what a lead magnet SHIPS AS on the feed, so it gets
          the same faithful card, and the same in-place editing, as a draft. */}
      <LmPromo d={d} lane={lane} refresh={refresh} />

      {heroImgs.length > 0 && (
        <Block label={heroImgs.length === 1 ? 'Cover' : `Covers · ${heroImgs.length}`}>
          <div className="a-mg-imgs">
            {heroImgs.map((u, i) => <img className="a-mg-img" src={u} alt="" key={`${u}-${i}`} />)}
          </div>
        </Block>
      )}

      <AnimatePresence initial={false}>
        {more && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, transition: fadeT }}
          >
            <LmActions d={d} hasCover={heroImgs.length > 0} onDone={refresh} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="a-mg-acts">
        {liveLinks[0] && (
          <Button variant="primary" iconEnd="external" onClick={() => { void openLive(liveLinks[0][1]) }}>
            Open {liveLinks[0][0].toLowerCase()}
          </Button>
        )}
        {next && (
          <Button variant="quiet" onClick={() => onPick(next)}>
            <Kbd>s</Kbd> Next
          </Button>
        )}
        <Button variant="quiet" aria-expanded={more} onClick={() => setMore(m => !m)}>
          <Kbd>o</Kbd> {more ? 'Hide actions' : 'More actions'}
        </Button>
        {hasRail && (
          <span className="a-mg-hint">
            <Kbd>j</Kbd><Kbd>k</Kbd> move · <Kbd>esc</Kbd> close
          </span>
        )}
      </div>
    </div>
  )

  const insp = (
    <aside className="a-mg-insp">
      <div className="a-mg-insp-h a-eyebrow">What decides it</div>

      {/* The landing artifact — what this lead magnet actually IS. Only a
          self-contained document earns the frame; a fragment whose styles live
          elsewhere would render as raw text. */}
      <Sec
        k="art" label="Landing artifact"
        tail={selfContainedHtml(artifact) ? undefined : (liveLinks.length ? 'live only' : 'none')}
        open={open} toggle={toggle}
      >
        {selfContainedHtml(artifact) ? (
          <HtmlPreview html={artifact} title="Landing page artifact" />
        ) : (
          <div className="a-ct-sub">
            {artifact
              ? 'The stored markup is a fragment whose styles live in the render service, so framing it here would show raw text rather than the page. The live URL below is the honest render.'
              : 'No rendered artifact stored on this row.'}
          </div>
        )}
        {liveLinks.length > 0 ? (
          <Block label="Live">
            <div className="a-mg-links">
              {liveLinks.map(([k, url]) => (
                <a className="a-link a-wrapline" href={url} target="_blank" rel="noreferrer" key={k}>
                  <span>{k}</span><Icon name="external" size={16} />
                </a>
              ))}
            </div>
          </Block>
        ) : (
          <div className="a-ct-sub">No live URL on this row yet.</div>
        )}
      </Sec>

      {qa ? (
        <Sec
          k="qa" label="QA verdict" tail={qa.score !== null ? `${qa.score}` : qa.verdict ?? undefined}
          open={open} toggle={toggle}
        >
          <QaRegister qa={qa} />
        </Sec>
      ) : (
        <Sec k="qa" label="QA verdict" tail="none" open={open} toggle={toggle}>
          <div className="a-ct-sub">No gate has scored this row.</div>
        </Sec>
      )}

      <Sec k="copy" label="Copy" open={open} toggle={toggle}>
        <LmField
          id={d.id} label="Email copy" field="email_copy" value={d.email_copy ?? ''}
          hint="The 24-hour follow-up." onDone={refresh}
        />
        {(d.description ?? '').trim() && (
          <Block label="Description"><Prose text={(d.description ?? '').trim()} /></Block>
        )}
      </Sec>

      <Sec
        k="log" label="Generation register" tail={log.length ? `${log.length}` : 'note only'}
        open={open} toggle={toggle}
      >
        <AgentRegister log={log} />
        <NoteComposer id={d.id} onDone={refresh} />
      </Sec>

      <Sec k="meta" label="Dates and fields" open={open} toggle={toggle}>
        {dates.length > 0 && <Block label="Dates"><KV rows={dates} /></Block>}
        {meta.length > 0 && <Block label="Fields"><KV rows={meta} /></Block>}
        {/* Agent-written shapes, rendered structurally, never as a JSX child. */}
        {d.landing_copy !== null && d.landing_copy !== undefined && (
          <Block label="Landing copy"><div className="a-mg-card"><Val v={d.landing_copy} /></div></Block>
        )}
        {d.spec !== null && d.spec !== undefined && (
          <Block label="Spec"><div className="a-mg-card"><Val v={d.spec} /></div></Block>
        )}
        {d.notes !== null && d.notes !== undefined && (
          <Block label="Notes"><div className="a-mg-card"><Val v={d.notes} /></div></Block>
        )}
        <div className="a-ct-sub">
          No approve here. Whether a watcher treats an approved status as a publish trigger is
          not readable from this app, so the one status this window will not write is that one.
        </div>
      </Sec>
    </aside>
  )

  return (
    <div className="a-mg-cols" data-rail={hasRail ? '' : undefined}>
      {hasRail && <QueueRail queue={queue} id={d.id} onPick={onPick} />}
      {main}
      {insp}
    </div>
  )
}

export function MagnetWindow({ id, lane, queue, onClose, onPick, mobile }: {
  id: string
  lane: ContentLane
  queue: MagnetQueueItem[]
  onClose: () => void
  onPick: (id: string) => void
  mobile: boolean
}) {
  const [bump, setBump] = useState(0)
  const reload = useCallback(() => setBump(b => b + 1), [])
  const { detail, missing, loading, error } = useResourceDetail(id, bump)
  const sub = `${LANE_LABEL[lane]}${detail?.format ? ` · ${detail.format}` : ''}`

  return (
    <Takeover label="Lead magnet" sub={sub} onClose={onClose} mobile={mobile} bodyClass="a-mg-scroll">
      {error ? (
        <Failed what="This lead magnet" message={error} loadedAt={null} />
      ) : loading && !detail ? (
        <div className="a-mg-load"><SkeletonRows rows={4} label="Reading this lead magnet" /></div>
      ) : missing || !detail ? (
        <EmptyState
          icon="alert"
          title="This lead magnet is no longer in the database."
          sub="It was removed while the lane was open."
        />
      ) : (
        <MagnetBody key={detail.id} d={detail} lane={lane} queue={queue} refresh={reload} onPick={onPick} />
      )}
    </Takeover>
  )
}
