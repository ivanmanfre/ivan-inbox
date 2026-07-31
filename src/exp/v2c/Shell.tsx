import { useCallback, useEffect, useMemo, useState } from 'react'
import { InboxScreen } from '../../screens/InboxScreen'
import { DraftsScreen } from '../../screens/DraftsScreen'
import { SendsScreen } from '../../screens/SendsScreen'
import { OpsScreen } from '../../screens/OpsScreen'
import { TodayScreen } from '../../screens/TodayScreen'
import { SettingsScreen } from '../../screens/SettingsScreen'
import { SeatHealthBanner } from '../../components/SeatHealthBanner'
import { InboxSkeleton } from '../../components/Skeleton'
import { useInbox } from '../../hooks/useInbox'
import { useOps } from '../../hooks/useOps'
import { pendingOps } from '../../lib/ops'
import type { Filter } from '../../lib/inbox'
import type { ContentLane } from '../../lib/content'
import { MobileTabs, Rail } from './Rail'
import { ContentList } from './ContentList'
import { DraftPane } from './DraftPane'
import { ThreadPeer } from './ThreadPeer'
import { InboxHead } from './InboxHead'
import { ChatPane } from './ChatPane'
import { CalmEmpty, Failed, relAge } from './Surface'
import { useChat } from './useChat'
import { useContentBadge } from './useContentBadge'
import { hasMock } from './mock'
import { parseWbHash, wbHash } from './route'
import {
  addPeer, contextPeer, dropPeer, hasChat, isWorkJob, jobHasList, peerKey,
  planWorkbench, type Canvas, type Job, type Peer,
} from './layout'
import './styles.css'

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
  const [prevJob, setPrevJob] = useState<Job>(boot.job === 'settings' ? 'inbox' : boot.job)
  // Claude is docked from the start on a canvas that has room for it. That is
  // the deliberate answer to "what fills the right region": the default peer is
  // the conversation, not a placeholder glyph.
  const [peers, setPeers] = useState<Peer[]>(
    // Docked by default wherever there is room for it; on a phone only when the
    // URL asked for it, because a phone peer is a takeover.
    () => (readCanvas() !== 'mobile' || boot.focus === 'chat' ? [{ kind: 'chat' } as Peer] : []),
  )
  const [focus, setFocus] = useState<string | null>(boot.focus)
  const [filter, setFilter] = useState<Filter>('all')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc'>('ivan')
  const [lane, setLane] = useState<ContentLane>('ivan')
  const [contentBump, setContentBump] = useState(0)

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
  const dmDrafts = inbox.threads.filter(t => t.draft).length
  const counts = {
    inbox: inbox.threads.filter(t => t.unread > 0).length,
    drafts: dmDrafts,
    ops: opsPend.length,
    content: badge.count,
  }
  const sev = {
    // Only a real problem takes a severity tier. A backlog of approvals is work,
    // not a warning — the audit's point 8.
    ops: opsError ? ('urgent' as const) : undefined,
    inbox: inboxError ? ('urgent' as const) : undefined,
  }

  const plan = planWorkbench(job, canvas, peers, focus)
  // A list job holding the WHOLE canvas needs its measure capped, or the ghost-pane
  // fix trades one defect (a dead pane) for another (a 1,240px message row).
  const solo = !mobile && plan.work === 'wide' && jobHasList(job)
  const ctx = contextPeer(peers)
  const ctxThread = ctx?.kind === 'thread'
    ? inbox.threads.find(t => t.prospect_id === ctx.id) ?? null
    : null
  // What the chat pane says it is asking about. On the wide canvas this labels a
  // pane Ivan can also see; on a phone it is the only surviving half of the pair.
  const aboutLabel = ctx
    ? ctx.kind === 'thread' ? ctxThread?.prospect_name ?? ctx.label ?? 'this thread' : ctx.label ?? 'this draft'
    : null

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
  const openDraft = useCallback(
    (id: string, label?: string) => openPeer({ kind: 'draft', id, label }), [openPeer])

  // ---- first paint ----
  if (inbox.loading && inbox.threads.length === 0 && !inboxError) {
    return (
      <div className={mobile ? 'app' : 'app dt wb'}>
        {!mobile && (
          <Rail job={job} counts={{}} sev={{}} chatOn={hasChat(peers)} chatLive={false}
            onJob={goJob} onChat={toggleChat} loadedAt={null} stale={false} onRefresh={inbox.refresh} />
        )}
        <div className="wb-regions">
          <div className="wb-work wide">
            <div className="nav"><div className="row-top"><h2>Inbox</h2></div></div>
            <InboxSkeleton />
          </div>
        </div>
        {mobile && (
          <MobileTabs job={job} counts={{}} chatLive={false} onJob={goJob} onChat={toggleChat} />
        )}
      </div>
    )
  }

  // ---- the working surface for the active job ----
  const inboxSurface = inboxError ? (
    <>
      <div className="nav"><div className="row-top"><h2>Inbox</h2><div className="avatar-me">IM</div></div></div>
      <Failed
        what="The inbox"
        message={inboxError}
        onRetry={inbox.refresh}
        loadedAt={inbox.threads.length > 0 ? inbox.loadedAt : null}
      />
    </>
  ) : (
    <InboxScreen
      threads={inbox.threads}
      filter={filter}
      setFilter={setFilter}
      refresh={inbox.refresh}
      onOpenThread={openThread}
      onOpenDrafts={() => goJob('drafts')}
      activeThread={ctx?.kind === 'thread' ? ctx.id : null}
      windowed
      head={<InboxHead threads={inbox.threads} loadedAt={inbox.loadedAt}
        onOpenDrafts={() => goJob('drafts')} />}
    />
  )

  const opsSurface = opsError ? (
    <>
      <div className="nav"><div className="row-top"><h2>Ops</h2></div></div>
      <Failed
        what="The ops queue"
        message={opsError}
        onRetry={ops.refresh}
        loadedAt={ops.drafts.length > 0 ? ops.loadedAt : null}
      />
    </>
  ) : opsPend.length === 0 && !ops.loading ? (
    <>
      <div className="nav"><div className="row-top"><h2>Ops</h2></div></div>
      {/* The audit's clearest actionable finding: Ops had nothing at all to
          distinguish a real zero from a stalled fetch. It has a stamp now. */}
      <CalmEmpty line="Nothing waiting on you." loadedAt={ops.loadedAt}
        sub="Comment replies, newsjacks, weekly reports and escalations all clear." />
      <OpsScreen />
    </>
  ) : <OpsScreen />

  const workSurface = (
    <>
      <SeatHealthBanner />
      {job === 'inbox' && inboxSurface}
      {job === 'drafts' && (
        inboxError
          ? <>
            <div className="nav"><div className="row-top"><h2>Drafts</h2></div></div>
            <Failed what="The draft queue" message={inboxError} onRetry={inbox.refresh}
              loadedAt={inbox.threads.length > 0 ? inbox.loadedAt : null} />
          </>
          : <DraftsScreen threads={inbox.threads} onOpenThread={openThread}
            refresh={inbox.refresh} onOpenOps={() => goJob('ops')} />
      )}
      {job === 'content' && (
        <ContentList
          key={`${lane}:${contentBump}`}
          lane={lane}
          setLane={setLane}
          openId={ctx?.kind === 'draft' ? ctx.id : null}
          onOpen={openDraft}
        />
      )}
      {job === 'sends' && <SendsScreen client={sendsClient} setClient={setSendsClient} />}
      {job === 'ops' && opsSurface}
      {job === 'today' && <TodayScreen />}
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
          onClose={() => closePeer('chat')}
          // Mobile only: no third region, so the pair degrades to a tappable
          // context card that flips focus back to the item.
          onOpenAbout={mobile && ctx ? () => setFocus(peerKey(ctx)) : null}
          mobile={mobile}
        />
      )
    }
    if (p.kind === 'draft') {
      return (
        <DraftPane
          id={p.id}
          lane={lane}
          refresh={() => setContentBump(b => b + 1)}
          onClose={() => closePeer(key)}
          onAsk={() => { setPeers(cur => addPeer(cur, { kind: 'chat' })); setFocus('chat') }}
          mobile={mobile}
        />
      )
    }
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

  // ---- mobile: one region at a time ----
  if (mobile) {
    if (plan.work === 'hidden' && plan.peers[0]) {
      const p = plan.peers[0]
      return (
        <div className={`app wb wb-take wb-take-${p.kind}`}>
          {renderPeer(p)}
        </div>
      )
    }
    return (
      <div className="app wb">
        <div className="wb-ribbon">
          {isWorkJob(job) ? (
            <div className="wb-workseg">
              {(['drafts', 'content'] as const).map(j => (
                <span key={j} className={`wb-ws${job === j ? ' on' : ''}`} onClick={() => goJob(j)}>
                  {j === 'drafts' ? 'DMs' : 'Content'}
                  {(counts[j] ?? 0) > 0 && <b>{counts[j]}</b>}
                </span>
              ))}
            </div>
          ) : <span className="wb-rib-j">{job === 'settings' ? 'Settings' : ''}</span>}
          <span className={`wb-rib-sync${inboxError ? ' bad' : ''}`} onClick={inbox.refresh}>
            <span className={`wb-sync-dot${inboxError ? ' stale' : ''}`} />
            {inboxError ? 'not syncing' : relAge(inbox.loadedAt)}
          </span>
          {job === 'settings'
            ? <span className="wb-gear" onClick={() => goJob(prevJob)}>Done</span>
            : <span className="wb-gear" onClick={() => goJob('settings')}>⚙︎</span>}
        </div>
        <div className={`wb-work wide${plan.narrow ? ' wb-narrow' : ''}`}>{workSurface}</div>
        <MobileTabs job={job} counts={counts} chatLive={chat.busy} onJob={goJob} onChat={toggleChat} />
      </div>
    )
  }

  // ---- desktop / wide: rail + regions ----
  return (
    <div className={`app dt wb wb-${canvas}`}>
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
  )
}
