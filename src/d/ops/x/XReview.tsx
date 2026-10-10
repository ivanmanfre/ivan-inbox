import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Segmented } from '../../../ds/Segmented'
import { LiveDot } from '../../../ds/Working'
import { wordCount } from '../../../lib/xArticleMd'
import { decideXArticle, decideXQuote, saveXArticle, saveXQuote, xFlagItems, type XArticle, type XQuote } from '../../../lib/xReview'
import { useFrameCounts } from '../../counts/useFrameCounts'
import type { Layout, PlaceProps } from '../../places'
import { dHash } from '../../route'
import { AnswerRow } from '../../ui/AnswerRow'
import { useDConfirm } from '../../ui/confirm'
import { Key } from '../../ui/Key'
import { Failed, Skeleton } from '../../ui/states'
import { warsawHm } from '../../ui/time'
import { useToast } from '../../ui/toast'
import { XLogo } from './glyphs'
import { XFlag } from './XFlag'
import { XArticlePreview, XPostPreview } from './XPreview'
import { useAutosave, type SaveStatus } from './useAutosave'
import { patchX, useXReview } from './useXReview'
import './x.css'

// X REVIEW: `#exp/d/ops/x?id=<article or quote id>`. Ivan, 2026-10-11: "allow me to click on the
// inputs and then on the same screen you open the X simulation so it should look like X so I can
// review in there". Phone: Preview / Edit on one screen (a tap on a paragraph in the preview opens
// the editor at that line). Desktop: editor and preview side by side. Publish and Post ask first.
// Hooks rule: every hook runs above any branch that returns.

const STATUS_WORD: Record<string, string> = { review: 'In review', draft: 'In review', approved: 'Publishing', publishing: 'Publishing', posting: 'Posting', published: 'Live', posted: 'Live', failed: 'Failed' }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function SaveLine({ status, error, savedAt, retry, readOnly }: { status: SaveStatus; error: string | null; savedAt: number | null; retry: () => void; readOnly: boolean }) {
  if (readOnly) return <div className="xr-save" data-save="locked">Locked: no longer in review.</div>
  if (status === 'error') {
    return (
      <div className="xr-save xr-save-err" data-save="error" role="alert">
        Not saved: {error}. Your text is kept on this phone.
        <button type="button" className="xr-link" data-verb="retry-save" onClick={retry}>Retry</button>
      </div>
    )
  }
  const text = status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Editing…' : savedAt ? `Saved ${warsawHm(savedAt)}` : 'Saved'
  return <div className="xr-save" data-save={status} aria-live="polite">{text}</div>
}

function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return ref
}

function StatusBanner({ kind, status, url, error }: { kind: 'article' | 'quote'; status: string; url: string | null; error: string | null }) {
  if (status === 'approved' || status === 'publishing' || status === 'posting') {
    return <div className="xr-ban xr-ban-moving" data-x-state="moving"><LiveDot label="Going out" />{kind === 'article' ? 'Publishing on X. Usually under a minute.' : 'Posting on X. Usually under a minute.'}</div>
  }
  if (status === 'published' || status === 'posted') {
    return <div className="xr-ban xr-ban-live" data-x-state="live"><XLogo size={14} /><b>Live on X</b>{url && <a href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, '')} ↗</a>}</div>
  }
  if (status === 'failed') {
    return <div className="xr-ban xr-ban-failed" data-x-state="failed" role="alert"><b>Did not go out.</b> {error ?? 'No error was recorded.'}</div>
  }
  return null
}

function host(u: string) { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

function Checks({ a, words }: { a: XArticle; words: number }) {
  const risks = a.qa?.remaining_risks ?? []
  const lint = a.qa?.lint ?? []
  const unconfirmed = (a.qa?.claims_checked ?? []).filter(c => c.ok === false && c.claim)
  const sources = a.sources ?? []
  return (
    <details className="xr-checks" data-x-checks>
      <summary>
        <span>Checks</span>
        <small>{words.toLocaleString('en-US')} words · {lint.length ? `${lint.length} lint` : 'lint clean'} · {risks.length} to check</small>
      </summary>
      {risks.length > 0 && <><h4>To check</h4><ul>{risks.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
      <h4>Lint</h4>
      {lint.length ? <ul className="xr-lint">{lint.map((r, i) => <li key={i}>{r}</li>)}</ul> : <p className="xr-quiet">Nothing flagged.</p>}
      {unconfirmed.length > 0 && <><h4>Claims the source did not confirm</h4><ul>{unconfirmed.map((c, i) => <li key={i}>{c.claim}{c.url && <> · <a href={c.url} target="_blank" rel="noreferrer">{host(c.url)}</a></>}</li>)}</ul></>}
      {sources.length > 0 && <><h4>Sources</h4><ul className="xr-sources">{sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer">{host(s.url)} ↗</a>{s.supports && <span>{s.supports}</span>}</li>)}</ul></>}
    </details>
  )
}

function Head({ layout, label, title, navigate, actions }: { layout: Layout; label: string; title: string; navigate: (h: string) => void; actions?: ReactNode }) {
  return (
    <div className={`xr-head xr-head-${layout}`}>
      <button type="button" className="d-ib xr-back" aria-label="Back to Ops" onClick={() => { if (!document.querySelector('.d-confirm')) navigate(dHash('ops')) }}>‹</button>
      <div className="xr-head-t"><small><XLogo size={11} /> {label}</small><b>{title}</b></div>
      {actions && <div className="xr-head-k">{actions}</div>}
    </div>
  )
}

function useDecide(kind: 'article' | 'quote', id: string, title: string, navigate: (h: string) => void, flush: () => Promise<boolean>) {
  const confirm = useDConfirm()
  const toast = useToast()
  const c = useFrameCounts()
  const { refresh: refreshCounts } = c
  const [busy, setBusy] = useState<null | 'go' | 'discard'>(null)
  const [err, setErr] = useState<string | null>(null)
  const go = useCallback(async () => {
    const ok = await confirm(kind === 'article'
      ? { title: 'Publish this article on X?', message: 'It goes live on @theivanpill within about a minute, with the title, cover, images and text as the preview shows them.', confirmText: 'Publish to X', verb: 'x-publish-confirm' }
      : { title: 'Post this on X?', message: 'It goes live on @theivanpill within about a minute: your line, the GIF, and the article quoted underneath.', confirmText: 'Post on X', verb: 'x-post-confirm' })
    if (!ok) return
    setBusy('go'); setErr(null)
    try {
      if (!await flush()) throw new Error('Your last edit is not saved, so nothing went out. Retry the save first')
      if (kind === 'article') {
        await decideXArticle(id, 'publish')
        patchX(l => ({ ...l, articles: l.articles.map(a => a.id === id ? { ...a, status: 'approved' } : a) }))
      } else {
        await decideXQuote(id, 'post')
        patchX(l => ({ ...l, quotes: l.quotes.map(q => q.id === id ? { ...q, status: 'approved' } : q) }))
      }
      refreshCounts('ops')
    } catch (e) { setErr(msg(e)) } finally { setBusy(null) }
  }, [confirm, kind, id, flush, refreshCounts])
  const discard = useCallback(async () => {
    const ok = await confirm({ title: kind === 'article' ? 'Discard this article?' : 'Discard this quote post?', message: 'It is cancelled and never goes to X.', confirmText: 'Discard', verb: 'x-discard-confirm', danger: true })
    if (!ok) return
    setBusy('discard'); setErr(null)
    try {
      if (kind === 'article') await decideXArticle(id, 'discard')
      else await decideXQuote(id, 'discard')
      patchX(l => ({ articles: l.articles.filter(a => a.id !== id), quotes: l.quotes.filter(q => q.id !== id) }))
      refreshCounts('ops')
      toast.show({ id: `x-${id}`, message: `Discarded · ${title}` })
      navigate(dHash('ops'))
    } catch (e) { setErr(msg(e)) } finally { setBusy(null) }
  }, [confirm, kind, id, title, navigate, refreshCounts, toast])
  return { busy, err, go, discard }
}

function Actions({ kind, d, canAct }: { kind: 'article' | 'quote'; d: ReturnType<typeof useDecide>; canAct: boolean }) {
  if (!canAct) return null
  return (
    <div className="xr-keys">
      <Key verb="x-discard" onClick={() => void d.discard()} disabled={d.busy !== null}>{d.busy === 'discard' ? 'Discarding…' : 'Discard'}</Key>
      <Key primary verb={kind === 'article' ? 'x-publish' : 'x-post'} onClick={() => void d.go()} disabled={d.busy !== null}>
        {d.busy === 'go' ? 'Sending…' : kind === 'article' ? 'Publish to X' : 'Post on X'}
      </Key>
    </div>
  )
}

const sameArticle = (x: { title: string; body: string }, y: { title: string; body: string }) => x.title === y.title && x.body === y.body

function ArticleReview({ a, layout, navigate }: { a: XArticle; layout: Layout; navigate: (h: string) => void }) {
  const editable = a.status === 'review'
  const server = useMemo(() => ({ title: a.title ?? '', body: a.body_md ?? '' }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useCallback((v: { title: string; body: string }) => saveXArticle(a.id, v.title, v.body), [a.id])
  const auto = useAutosave({ backupKey: `x-review-draft:${a.id}`, server, equal: sameArticle, save, enabled: editable })
  const { title, body } = auto.value
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const bodyRef = useAutosize(body)
  const titleRef = useAutosize(title)
  const editCol = useRef<HTMLDivElement>(null)
  const d = useDecide('article', a.id, title || 'Untitled article', navigate, auto.flush)
  const words = wordCount(body)

  // A tap on a block in the preview: open the editor with the caret at that line.
  const onLine = useCallback((line: number | null) => {
    if (!editable) return
    if (layout === 'phone') setMode('edit')
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (line === null) { titleRef.current?.focus(); return }
      const el = bodyRef.current
      if (!el) return
      const lines = el.value.split('\n')
      const off = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0)
      el.focus({ preventScroll: true })
      el.setSelectionRange(off, off + (lines[line]?.length ?? 0))
      const ratio = el.value.length ? off / el.value.length : 0
      const y = el.getBoundingClientRect().top + ratio * el.scrollHeight - 140
      const col = editCol.current
      if (layout === 'desktop' && col) col.scrollBy({ top: y - col.getBoundingClientRect().top })
      else window.scrollBy({ top: y })
    }))
  }, [editable, layout, bodyRef, titleRef])

  const editor = (
    <div className="xr-editor" data-x-editor>
      <label className="xr-field">
        <span>Title</span>
        <textarea ref={titleRef} rows={1} className="xr-input xr-title" value={title} readOnly={!editable} data-x-title
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
          onChange={e => auto.setValue({ title: e.target.value.replace(/\n/g, ' '), body })} onBlur={() => void auto.flush()} />
      </label>
      <label className="xr-field">
        <span>Article text <small>{words.toLocaleString('en-US')} words</small></span>
        <textarea ref={bodyRef} className="xr-input xr-body" value={body} readOnly={!editable} data-x-body spellCheck
          onChange={e => auto.setValue({ title, body: e.target.value })} onBlur={() => void auto.flush()} />
      </label>
      <p className="xr-hint">## heading · ### small heading · **bold** · [text](https://link) · - bullet · 1. numbered · &gt; quote · {'{{IMAGE:1}}'} on its own line</p>
    </div>
  )
  const preview = <XArticlePreview title={title} body={body} cover={a.cover_url} images={a.images} handle={a.account || 'theivanpill'} onLine={editable ? onLine : undefined} />
  const top = (
    <>
      <StatusBanner kind="article" status={a.status} url={a.x_url} error={a.error} />
      {auto.restored && editable && <div className="xr-ban">Restored edits from this device that had not reached the server. They save now.</div>}
      {d.err && <div className="xr-ban xr-ban-failed" role="alert">{d.err}</div>}
    </>
  )
  const saveLine = <SaveLine status={auto.status} error={auto.error} savedAt={auto.savedAt} retry={() => void auto.flush()} readOnly={!editable} />

  if (layout === 'desktop') {
    return (
      <div className="xr xr-desktop" data-x-review="article">
        <AnswerRow title="X review" sub="What you see on the right is what X receives." />
        <Head layout={layout} label={`Article · ${STATUS_WORD[a.status] ?? a.status}`} title={title || 'Untitled article'} navigate={navigate} actions={<>{saveLine}<Actions kind="article" d={d} canAct={editable} /></>} />
        <div className="xr-top">{top}</div>
        <div className="xr-cols">
          <div className="xr-col xr-col-edit" ref={editCol}>{editor}<Checks a={a} words={words} /></div>
          <div className="xr-col xr-col-prev"><div className="xr-stage">{preview}</div></div>
        </div>
      </div>
    )
  }
  return (
    <div className="xr xr-phone" data-x-review="article">
      <Head layout={layout} label={`Article · ${STATUS_WORD[a.status] ?? a.status}`} title={title || 'Untitled article'} navigate={navigate} />
      {top}
      <div className="xr-bar">
        <Segmented options={[{ id: 'preview', label: 'Preview on X' }, { id: 'edit', label: 'Edit' }]} value={mode} onChange={m => setMode(m as 'preview' | 'edit')} label="Preview or edit" markerId="xr-mode" block className="xr-seg" />
        {saveLine}
      </div>
      {mode === 'edit' ? editor : <div className="xr-stage">{preview}{editable && <p className="xr-tip">Tap any paragraph to edit it.</p>}</div>}
      <Checks a={a} words={words} />
      <Actions kind="article" d={d} canAct={editable} />
    </div>
  )
}

const sameHook = (x: string, y: string) => x === y

function QuoteReview({ q, layout, navigate }: { q: XQuote; layout: Layout; navigate: (h: string) => void }) {
  const editable = q.status === 'draft'
  const server = useMemo(() => q.hook ?? '', []) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useCallback((v: string) => saveXQuote(q.id, v), [q.id])
  const auto = useAutosave({ backupKey: `x-review-quote:${q.id}`, server, equal: sameHook, save, enabled: editable })
  const hook = auto.value
  const ref = useAutosize(hook)
  const d = useDecide('quote', q.id, hook || 'Quote post', navigate, auto.flush)
  const options = (q.hook_options ?? []).filter(o => typeof o === 'string' && o.trim())
  const editor = (
    <div className="xr-editor" data-x-editor>
      <label className="xr-field">
        <span>Line <small>{hook.length} characters</small></span>
        <textarea ref={ref} rows={2} className="xr-input xr-line" value={hook} readOnly={!editable} data-x-hook
          onChange={e => auto.setValue(e.target.value)} onBlur={() => void auto.flush()} />
      </label>
      {options.length > 0 && (
        <div className="xr-chips" role="group" aria-label="Other lines">
          {options.map((o, i) => (
            <button key={i} type="button" className={`xr-chip${o === hook ? ' xr-chip-on' : ''}`} data-verb="x-hook-option" disabled={!editable}
              onClick={() => auto.setValue(o)}>{o}</button>
          ))}
        </div>
      )}
      <div className="xr-links">
        {q.dry_run_shot_url && <a href={q.dry_run_shot_url} target="_blank" rel="noreferrer">Real composer screenshot ↗</a>}
        {q.quoted_url && <a href={q.quoted_url} target="_blank" rel="noreferrer">Quoted post ↗</a>}
      </div>
    </div>
  )
  const preview = <XPostPreview text={hook} media={q.media_url} handle={q.account || 'theivanpill'} quoteTitle={q.article_title} quoteCover={q.article_cover} />
  const saveLine = <SaveLine status={auto.status} error={auto.error} savedAt={auto.savedAt} retry={() => void auto.flush()} readOnly={!editable} />
  const top = (
    <>
      <StatusBanner kind="quote" status={q.status} url={q.posted_url} error={q.error} />
      {auto.restored && editable && <div className="xr-ban">Restored edits from this device that had not reached the server. They save now.</div>}
      {d.err && <div className="xr-ban xr-ban-failed" role="alert">{d.err}</div>}
    </>
  )
  if (layout === 'desktop') {
    return (
      <div className="xr xr-desktop" data-x-review="quote">
        <AnswerRow title="X review" sub="What you see on the right is what X posts." />
        <Head layout={layout} label={`Quote post · ${STATUS_WORD[q.status] ?? q.status}`} title={q.article_title ? `Quoting: ${q.article_title}` : 'Quote post'} navigate={navigate} actions={<>{saveLine}<Actions kind="quote" d={d} canAct={editable} /></>} />
        <div className="xr-top">{top}</div>
        <div className="xr-cols">
          <div className="xr-col xr-col-edit">{editor}</div>
          <div className="xr-col xr-col-prev"><div className="xr-stage">{preview}</div></div>
        </div>
      </div>
    )
  }
  return (
    <div className="xr xr-phone" data-x-review="quote">
      <Head layout={layout} label={`Quote post · ${STATUS_WORD[q.status] ?? q.status}`} title={q.article_title ? `Quoting: ${q.article_title}` : 'Quote post'} navigate={navigate} />
      {top}
      <div className="xr-stage">{preview}</div>
      <div className="xr-bar xr-bar-plain">{saveLine}</div>
      {editor}
      <Actions kind="quote" d={d} canAct={editable} />
    </div>
  )
}

export default function XReviewPage({ layout, route, navigate }: PlaceProps) {
  const x = useXReview()
  const id = route.query.get('id')
  const items = useMemo(() => xFlagItems(x.list), [x.list])
  const article = id ? x.list?.articles.find(a => a.id === id) ?? null : null
  const quote = id && !article ? x.list?.quotes.find(q => q.id === id) ?? null : null
  const first = !id ? items.find(i => i.state === 'waiting') ?? null : null

  if (article) return <ArticleReview key={article.id} a={article} layout={layout} navigate={navigate} />
  if (quote) return <QuoteReview key={quote.id} q={quote} layout={layout} navigate={navigate} />
  const head = <Head layout={layout} label="X review" title={first ? 'Waiting on you' : 'X review'} navigate={navigate} />
  if (!x.list && x.error) return <div className={`xr xr-${layout}`}>{head}<Failed what="the X review list" detail={x.error} onRetry={() => void x.refresh()} /></div>
  if (!x.list) return <div className={`xr xr-${layout}`}>{head}<Skeleton lines={8} label="Reading the X review" /></div>
  return (
    <div className={`xr xr-${layout} xr-index`}>
      {head}
      {id && <div className="xr-ban">That item is not in the X review any more: it was discarded or it aged out.</div>}
      {items.length ? <XFlag /> : <p className="xr-quiet xr-none">Nothing waiting on X.</p>}
    </div>
  )
}
