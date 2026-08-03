import { useCallback, useEffect, useMemo, useState } from 'react'
import { SendsScreen } from '../../screens/SendsScreen'
import { TodayScreen } from '../../screens/TodayScreen'
import { SettingsScreen } from '../../screens/SettingsScreen'
import { SeatHealthBanner } from '../../components/SeatHealthBanner'
import { InboxSkeleton } from '../../components/Skeleton'
import { useInbox } from '../../hooks/useInbox'
import { useOps } from '../../hooks/useOps'
import { pendingOps } from '../../lib/ops'
import { inboxWaitingCount, type Filter, type Status } from '../../lib/inbox'
import type { ContentLane } from '../../lib/content'
import { MobileTabs, Rail, WorkSegment } from './Rail'
import { ContentList } from './ContentList'
import { MagnetsList } from './MagnetsList'
import { DraftWindow } from './DraftPane'
import { MagnetWindow } from './MagnetWindow'
import { ThreadPeer } from './ThreadPeer'
import { DmsSurface } from './DmsSurface'
import { ChatPane } from './ChatPane'
import { OpsBoard } from './OpsBoard'
import { Failed, relAge } from './Surface'
import { useChat } from './useChat'
import { useContentBadge } from './useContentBadge'
import { hasMock } from './mock'
import { parseWbHash, wbHash } from './route'
import {
  addPeer, contextPeer, dropPeer, hasChat, jobHasList, peerKey,
  planWorkbench, type Canvas, type Job, type Peer,
} from './layout'
import './styles.css'
// Candidate `faithful` — the treatment layer. Imported AFTER the workbench's own
// stylesheet (spine §1.3) so it is the last word inside .wb and has no reach at
// all outside it. :root in src/styles.css is never touched.
import './faithful.css'

// ============================================================================
// Candidate v2c — WORKBENCH
//
// The premise the aesthetics audit established: desktop is a stretched phone.
// The mobile canvas is capped at 480px (styles.css:28); above 1000px that cap
// lifts (styles.css:284) into a 400px list beside a ~950px pane which, on three
// of six routes, holds one glyph and the words "Select a conversation" — on two
// of those routes no conversation can ever open at all.
//
// This candidate's answer is structural, not cosmetic:
//
//   1. A persistent RAIL of jobs replaces the bottom bar on desktop. A rail is
//      not slot-limited, so Content stops competing for a tab and Settings stops
//      needing to be demoted.
//   2. The middle column is the WORKING LIST.
//   3. The right region is a CONTEXT PEER — a thread, a content draft, or Claude —
//      and at 1440px it can hold two of them, so Ivan can talk to Claude while
//      looking at the draft he is asking about. That is the candidate.
//   4. There is no empty second region. With no peer open the working surface
//      takes the whole canvas, so the ghost pane has nowhere to render (A1).
//
// Every width branch in this candidate is one pure function (layout.ts,
// planWorkbench) unit-tested in node. Phase 0 found that fork copy-pasted into
// four files; nothing below Shell reads a viewport.
// ============================================================================

// Two media queries, one hook. 'wide' is the two-peer canvas: 1440px is exactly
// rail 200 + list 400 + peer 420 + peer 420.
const MQ_DESKTOP = '(min-width: 1000px)'
const MQ_WIDE = '(min-width: 1320px)'

function readCanvas(): Canvas {
  if (typeof window === 'undefined') return 'mobile'
  if (window.matchMedia(MQ_WIDE).matches) return 'wide'
  if (window.matchMedia(MQ_DESKTOP).matches) return 'desktop'
  return 'mobile'
}

function useCanvas(): Canvas {
  const [canvas, setCanvas] = useState<Canvas>(readCanvas)
  useEffect(() => {
    const on = () => setCanvas(readCanvas())
    const a = window.matchMedia(MQ_DESKTOP)
    const b = window.matchMedia(MQ_WIDE)
    a.addEventListener('change', on)
    b.addEventListener('change', on)
    return () => { a.removeEventListener('change', on); b.removeEventListener('change', on) }
  }, [])
  return canvas
}

export default function Shell() {
  const canvas = useCanvas()
  const mobile = canvas === 'mobile'
  const boot = useMemo(() => parseWbHash(location.hash), [])

  const [job, setJob] = useState<Job>(boot.job)
  const [prevJob, setPrevJob] = useState<Job>(boot.job === 'settings' ? 'dms' : boot.job)
  // Claude opens when Ivan opens it (his call, 2026-08-03) — never on boot. The
  // pane used to dock itself on any canvas with room, which meant the working
  // surface started the session sharing the width with a conversation nobody
  // had asked for. The rail button and #exp/v2/<job>/chat both still open it.
  const [peers, setPeers] = useState<Peer[]>(
    () => (boot.focus === 'chat' ? [{ kind: 'chat' } as Peer] : []),
  )
  const [focus, setFocus] = useState<string | null>(boot.focus)
  const [filter, setFilter] = useState<Filter>('all')
  // The status axis of DMs. 'needs' — what the badge counts — is the view the
  // surface opens on; the other buckets are one click away in the head.
  const [status, setStatus] = useState<Status>('needs')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc'>('ivan')
  const [lane, setLane] = useState<ContentLane>('ivan')
  const [contentBump, setContentBump] = useState(0)
  // The reading window (usability-voice ask 2). A draft or a lead magnet opened
  // from Content/Magnets is a TAKEOVER over the canvas, not a 420px peer — the
  // peers model stays for chat and inbox threads only.
  const [openItem, setOpenItem] = useState<{ kind: 'draft' | 'magnet'; id: string } | null>(null)

  // ---- data, mounted ONCE, here ----
  //
  // useInbox pages up to 20,000 rows in sequential 1,000-row requests, and the
  // live inbox renders 83,453px of DOM from ~1,354 unvirtualized rows. A
  // workbench that mounted it in the list column AND in a pane would pay that
  // twice. It is mounted exactly once, at the top, and the thread a peer renders
  // is looked up out of the same array — a peer never fetches its own copy.
  // (The topic is also namespaced now, so a second mount could not black the
  // tree out even if a later edit added one.)
  const inbox = useInbox()
  const ops = useOps()
  const chat = useChat()
  const badge = useContentBadge()

  const forceFail = hasMock('fetch-error')
  const inboxError = inbox.error ?? (forceFail ? 'PostgREST returned 500 for inbox_messages_v' : null)
  const opsError = ops.error ?? (forceFail ? 'PostgREST returned 500 for ops_drafts' : null)

  const opsPend = pendingOps(ops.drafts)
  const counts = {
    // Ask 11 — the "56" was every thread with an unread inbound row, 28 of
    // which Ivan had already answered in the LinkedIn app (the mirror writes
    // the outbound, nothing stamps read_at). The badge now counts only what is
    // genuinely waiting: unanswered replies + drafts to approve + threads the
    // reply detector flagged needs_manual_reply. Same derivation as the list
    // and the InboxHead breakdown (lib/inbox.ts, inboxBreakdown).
    dms: inboxWaitingCount(inbox.threads),
    ops: opsPend.length,
    content: badge.count,
  }
  const sev = {
    // Only a real problem takes a severity tier. A backlog of approvals is work,
    // not a warning — the audit's point 8.
    ops: opsError ? ('urgent' as const) : undefined,
    dms: inboxError ? ('urgent' as const) : undefined,
  }

  const plan = planWorkbench(job, canvas, peers, focus)
  // A list job holding the WHOLE canvas needs its measure capped, or the ghost-pane
  // fix trades one defect (a dead pane) for another (a 1,240px message row).
  const solo = !mobile && plan.work === 'wide' && jobHasList(job)
  const ctx = contextPeer(peers)
  const ctxThread = ctx?.kind === 'thread'
    ? inbox.threads.find(t => t.prospect_id === ctx.id) ?? null
    : null
  // What the chat pane says it is asking about. Only inbox threads dock as
  // context peers now — a draft opens as a reading window instead, so the
  // draft-flavoured context label went with the draft peer.
  const aboutLabel = ctx ? ctxThread?.prospect_name ?? ctx.label ?? 'this thread' : null
  const aboutContext = aboutLabel

  // ---- Fork 2 is DECIDED: Ivan voted TRIAD (2026-08-02, "color i want tried"). ----
  // Triad is the boot default — absence of any signal means triad. Mono stays
  // built and reachable (`?cat=mono`, or localStorage 'wb-cat'='mono'),
  // undocumented. Setting an ATTRIBUTE on <html> is not editing :root's tokens —
  // MONO is declared in `.wb{…}` and TRIAD in `:root[data-cat='triad'] .wb{…}`,
  // so the toggle changes colour values only and shifts no layout.
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('cat')
    let stored: string | null = null
    try { stored = localStorage.getItem('wb-cat') } catch { /* private mode */ }
    const cat = q ?? stored
    document.documentElement.setAttribute('data-cat', cat === 'mono' ? 'mono' : 'triad')
    if (q === 'mono' || q === 'triad') { try { localStorage.setItem('wb-cat', q) } catch { /* ok */ } }
  }, [])

  // ---- ⌘D: start/stop speaking (phase 3, Ivan's verbatim ask). One keydown
  // listener while the workbench is mounted; ChatPane owns what "toggle"
  // means (composer mic, or the live loop's mic when that sheet is open).
  // Chrome binds ⌘D to "bookmark this page" — preventDefault() suppresses
  // that inside the workbench, which is exactly what was asked for.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('wb-voice-toggle'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- hash: job + focus are addressable, so every surface has a fresh-load URL ----
  useEffect(() => {
    const apply = () => {
      const r = parseWbHash(location.hash)
      setJob(r.job)
      if (r.focus === 'chat') {
        setPeers(p => addPeer(p, { kind: 'chat' }))
        setFocus('chat')
      }
    }
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])
  useEffect(() => {
    if (!location.hash.startsWith('#access_token')) {
      history.replaceState(null, '', wbHash(job, focus === 'chat' ? 'chat' : null))
    }
  }, [job, focus])

  // ---- navigation ----
  const goJob = useCallback((j: Job) => {
    setJob(cur => { if (cur !== 'settings') setPrevJob(cur); return j })
    // A phone can only show one thing: picking a job drops whatever peer had
    // taken the screen over. On desktop the peer keeps its place beside it.
    if (readCanvas() === 'mobile') setFocus(null)
  }, [])

  const openPeer = useCallback((p: Peer) => {
    setPeers(cur => addPeer(cur, p))
    setFocus(peerKey(p))
  }, [])

  const closePeer = useCallback((key: string) => {
    setPeers(cur => dropPeer(cur, key))
    setFocus(f => (f === key ? null : f))
  }, [])

  const toggleChat = useCallback(() => {
    setPeers(cur => (hasChat(cur) && (readCanvas() !== 'mobile' || focus === 'chat')
      ? dropPeer(cur, 'chat')
      : addPeer(cur, { kind: 'chat' })))
    setFocus(f => (f === 'chat' ? null : 'chat'))
  }, [focus])

  const openThread = useCallback((id: string) => openPeer({ kind: 'thread', id }), [openPeer])
  // Ask 2 — a draft is a READING surface, so it opens the takeover window, not
  // a peer. Same for a lead-magnet row.
  const openDraft = useCallback((id: string) => setOpenItem({ kind: 'draft', id }), [])
  const openMagnet = useCallback((id: string) => setOpenItem({ kind: 'magnet', id }), [])
  const closeItem = useCallback(() => setOpenItem(null), [])

  // ---- first paint ----
  // Spine §1.7 — the ONE licensed structural edit. At 390 the loading state used
  // to carry no `.wb` class at all, so the iOS :root palette showed through for
  // the first seconds of every cold mobile load.
  if (inbox.loading && inbox.threads.length === 0 && !inboxError) {
    return (
      <div className={mobile ? 'app wb' : 'app dt wb'}>
        {/* style-delta §3a — the ONE licensed DOM change: the app plate the
            two-surface inversion rests on. Same wrapper at all three roots. */}
        <div className="wb-plate">
          {!mobile && (
            <Rail job={job} counts={{}} sev={{}} chatOn={hasChat(peers)} chatLive={false}
              onJob={goJob} onChat={toggleChat} loadedAt={null} stale={false} onRefresh={inbox.refresh} />
          )}
          <div className="wb-regions">
            <div className="wb-work wide">
              <div className="nav"><div className="row-top"><h2>DMs</h2></div></div>
              <InboxSkeleton />
            </div>
          </div>
          {mobile && (
            <MobileTabs job={job} counts={{}} sev={{}} chatLive={false} onJob={goJob} onChat={toggleChat} />
          )}
        </div>
      </div>
    )
  }

  // ---- the working surface for the active job ----
  const stale = inbox.threads.length > 0
  const dmsList = (
    <DmsSurface
      threads={inbox.threads}
      opsDrafts={ops.drafts}
      filter={filter} setFilter={setFilter}
      status={status} setStatus={setStatus}
      refresh={inbox.refresh}
      onOpenThread={openThread}
      onOpenOps={() => goJob('ops')}
      // The Shell is the surface that KNOWS there was no error (it renders
      // Failed below instead), so it is the one allowed to hand the list its
      // freshness.
      loadedAt={inbox.loadedAt}
    />
  )
  const dmsSurface = inboxError ? (
    <>
      <div className="nav"><div className="row-top"><h2>DMs</h2><div className="avatar-me">IM</div></div></div>
      <Failed
        what="Your DMs"
        message={inboxError}
        onRetry={inbox.refresh}
        loadedAt={stale ? inbox.loadedAt : null}
      />
      {/* Stale rows still beat a void, and the banner above is what makes them
          honest — but the banner only CLAIMS stale data when there is some.
          wb-hidenav suppresses the WRAPPED screen's own header: the region above
          already carries one, and two "DMs" titles in a column is the exact
          doubled-render defect the panel flagged on Ops. */}
      {stale && <div className="wb-stalewrap wb-hidenav">{dmsList}</div>}
    </>
  ) : dmsList

  // Ops is no longer a wrapped production screen. OpsBoard owns the frame and
  // reuses the screen's PendingCard + OpsGroups, so there is exactly one header,
  // one empty state, one approve path — and one useOps mount, this one.
  const opsSurface = (
    <OpsBoard
      drafts={ops.drafts}
      loading={ops.loading}
      error={opsError}
      loadedAt={ops.loadedAt}
      refresh={ops.refresh}
    />
  )

  const workSurface = (
    <>
      <SeatHealthBanner />
      {/* One model, both canvases: the lane switch for Work lives HERE now, not in
          the mobile ribbon, so desktop and phone teach the same thing (MF3). */}
      <WorkSegment job={job} counts={counts} onJob={goJob} />
      {job === 'dms' && dmsSurface}
      {job === 'content' && (
        <ContentList
          key={`${lane}:${contentBump}`}
          lane={lane}
          setLane={setLane}
          openId={openItem?.kind === 'draft' ? openItem.id : null}
          onOpen={openDraft}
        />
      )}
      {/* Magnets shares the SAME lane state as Content — switching lane in one
          tab is reflected in the other. No badge on this job on purpose:
          useContentBadge counts carousel_drafts rows at review (posts waiting
          on Ivan); the LM lane is read-only here, so a count would advertise
          an action this surface does not offer. */}
      {job === 'magnets' && (
        <MagnetsList lane={lane} setLane={setLane} onOpen={openMagnet} />
      )}
      {job === 'sends' && <SendsScreen client={sendsClient} setClient={setSendsClient} />}
      {job === 'ops' && opsSurface}
      {/* Today aggregates, so its hand-off rows navigate INSIDE the workbench
          rather than through the default app's hash routes. */}
      {job === 'today' && (
        <TodayScreen onOpenDrafts={() => goJob('dms')} onOpenOps={() => goJob('ops')} />
      )}
      {job === 'settings' && <SettingsScreen />}
    </>
  )

  // ---- peers ----
  const renderPeer = (p: Peer) => {
    const key = peerKey(p)
    if (p.kind === 'chat') {
      return (
        <ChatPane
          chat={chat}
          job={job}
          about={aboutLabel}
          aboutContext={aboutContext}
          onClose={() => closePeer('chat')}
          // Mobile only: no third region, so the pair degrades to a tappable
          // context card that flips focus back to the item.
          onOpenAbout={mobile && ctx ? () => setFocus(peerKey(ctx)) : null}
          mobile={mobile}
        />
      )
    }
    // kind:'draft' peers are no longer created anywhere — a draft opens as the
    // takeover window (openItem). The layout model keeps the kind so the pure
    // functions stay general, but the Shell has no renderer for it.
    if (!ctxThread) {
      return (
        <div className="wb-empty">
          <div className="wb-empty-l">That thread is no longer in the inbox.</div>
          <div className="wb-empty-s">It may have been resolved on another device.</div>
        </div>
      )
    }
    return (
      <ThreadPeer
        thread={ctxThread}
        refresh={inbox.refresh}
        onClose={() => closePeer(key)}
        onAsk={() => { setPeers(cur => addPeer(cur, { kind: 'chat' })); setFocus('chat') }}
        mobile={mobile}
      />
    )
  }

  // ---- the reading window, over whichever frame is active ----
  const itemWindow = openItem && (
    openItem.kind === 'draft'
      ? <DraftWindow
          id={openItem.id} lane={lane}
          refresh={() => setContentBump(b => b + 1)}
          onClose={closeItem} mobile={mobile}
        />
      : <MagnetWindow id={openItem.id} lane={lane} onClose={closeItem} mobile={mobile} />
  )

  // ---- mobile: one region at a time ----
  if (mobile) {
    if (plan.work === 'hidden' && plan.peers[0]) {
      const p = plan.peers[0]
      return (
        <div className={`app wb wb-take wb-take-${p.kind}`}>
          {renderPeer(p)}
          {itemWindow}
        </div>
      )
    }
    return (
      <div className="app wb">
        {/* style-delta §3a — the plate. The takeover window (itemWindow) is a
            fixed overlay and stays OUTSIDE it. */}
        <div className="wb-plate">
          <div className="wb-ribbon">
            {/* The lane switch moved into the working surface (WorkSegment) so both
                viewports carry the identical control. The ribbon keeps what belongs
                to the FRAME: how fresh the data is, and the way out to Settings. */}
            <span className="wb-rib-j">{job === 'settings' ? 'Settings' : ''}</span>
            <span className={`wb-rib-sync${inboxError ? ' bad' : ''}`} onClick={inbox.refresh}>
              <span className={`wb-sync-dot${inboxError ? ' bad' : ''}`} />
              {inboxError ? 'not syncing' : relAge(inbox.loadedAt)}
            </span>
            {job === 'settings'
              ? <span className="wb-gear" onClick={() => goJob(prevJob)}>Done</span>
              : <span className="wb-gear" onClick={() => goJob('settings')}>⚙︎</span>}
          </div>
          <div className={`wb-work wide${plan.narrow ? ' wb-narrow' : ''}`}>{workSurface}</div>
          <MobileTabs job={job} counts={counts} sev={sev} chatLive={chat.busy} onJob={goJob} onChat={toggleChat} />
        </div>
        {itemWindow}
      </div>
    )
  }

  // ---- desktop / wide: rail + regions ----
  return (
    <div className={`app dt wb wb-${canvas}`}>
      {/* style-delta §3a — the plate: rail | regions ride inside it; the
          takeover window is a fixed overlay and stays outside. */}
      <div className="wb-plate">
        <Rail
          job={job}
          counts={counts}
          sev={sev}
          chatOn={hasChat(peers)}
          chatLive={chat.busy}
          onJob={goJob}
          onChat={toggleChat}
          loadedAt={inbox.loadedAt}
          stale={!!inboxError}
          onRefresh={inbox.refresh}
        />
        <div className={`wb-regions peers-${plan.peers.length}`}>
          <div className={`wb-work ${plan.work}${plan.narrow ? ' wb-narrow' : ''}${solo ? ' wb-solo' : ''}`}>
            {workSurface}
          </div>
          {plan.peers.map(p => (
            <div
              className={`wb-peer wb-peer-${p.kind}${focus === peerKey(p) ? ' on' : ''}`}
              key={peerKey(p)}
            >
              {renderPeer(p)}
            </div>
          ))}
        </div>
      </div>
      {itemWindow}
    </div>
  )
}
