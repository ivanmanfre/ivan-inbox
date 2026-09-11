// src/orbit/PersonPanel.tsx — the person sheet (bottom on phone, right rail
// >=1000px via orbit.css media queries). Display-only history + four actions,
// every one showing its exact effect BEFORE the tap and its live blockers
// AFTER, from actions.pickability(). Never edits or authors any DM text.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconButton, Chip } from '../ds'
import { relAge } from '../wb/kit'
import {
  addToLane, addToLaneEffect, addToLaneSuccessNote, fetchProspectRow, pickability,
  queueInvite, queueInviteEffect, skip as skipAction, skipEffect,
  type ProspectRow,
} from './actions'
import { pickableLanes } from './filters'
import { STAGE_LABEL, type OrbitLane, type OrbitPerson, type OrbitPersonDetail, type OrbitTenant } from './types'

// signal_events kinds that mean "they moved" rather than "we moved". Kept
// local: only this panel colours a kind by direction, and types.ts no longer
// carries an EventKind/INBOUND_KINDS export (the renderer seat owns that file
// now and trimmed it to what OrbitCanvas needs).
const INBOUND_KINDS = new Set(['reaction', 'comment', 'reply', 'view_in', 'dm_in', 'email_in', 'booked'])

export interface PersonPanelProps {
  person: OrbitPerson | null
  tenant: OrbitTenant
  lanes: OrbitLane[]
  onClose: () => void
}

type Busy = 'queue' | 'skip' | 'lane' | null

export function PersonPanel({ person, tenant, lanes, onClose }: PersonPanelProps) {
  const open = person != null

  // --- full history, fetched fresh per person -------------------------------
  const [detail, setDetail] = useState<OrbitPersonDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  // Deliberately keyed on person?.id (not `person`): the graph object gets a
  // new identity on every 60s poll even when the same person is still open,
  // and re-running signal_person on every poll would fight the panel's own
  // write-driven refetches with a redundant read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDetail(null); setDetailError(null)
    if (!person) return
    let alive = true
    supabase.rpc('signal_person', { p_client: tenant, p_contact: person.id }).then(({ data, error }) => {
      if (!alive) return
      if (error) { setDetailError(error.message); return }
      setDetail(data as OrbitPersonDetail)
    })
    return () => { alive = false }
  }, [person?.id, tenant])

  // --- sender-gate row + pickability, refetched after every write ----------
  const [prospectRow, setProspectRow] = useState<ProspectRow | null>(null)
  useEffect(() => {
    setProspectRow(null)
    if (!person?.pid) return
    let alive = true
    fetchProspectRow(person.pid).then(r => { if (alive) setProspectRow(r) }).catch(() => { if (alive) setProspectRow(null) })
    return () => { alive = false }
  }, [person?.pid])

  const laneRow = useMemo(() => lanes.find(l => l.id === person?.camp) ?? null, [lanes, person?.camp])

  const pick = useMemo(() => {
    if (!prospectRow) return null
    return pickability(tenant, { ...prospectRow, campaignActive: laneRow?.active ?? null, campaignLane: laneRow?.lane ?? null })
  }, [prospectRow, tenant, laneRow])

  // --- actions ---------------------------------------------------------------
  const [busy, setBusy] = useState<Busy>(null)
  const [queueNote, setQueueNote] = useState<string | null>(null)
  const [skipNote, setSkipNote] = useState<string | null>(null)
  const [laneNote, setLaneNote] = useState<string | null>(null)
  const [lanePickerOpen, setLanePickerOpen] = useState(false)

  const refetchRow = useCallback(async (pid: string) => {
    const fresh = await fetchProspectRow(pid)
    setProspectRow(fresh)
  }, [])

  const openThread = useCallback(() => {
    if (!person?.pid) return
    location.hash = '#exp/brain-b/dms?thread=' + person.pid
  }, [person?.pid])

  const doQueue = useCallback(async () => {
    if (!person?.pid) return
    setBusy('queue'); setQueueNote(null)
    try {
      const r = await queueInvite(tenant, person.pid)
      if (!r.ok) { setQueueNote(`Blocked: ${r.blocker}`) }
      else {
        setQueueNote(r.remaining.ok ? 'Queued — clears every sender gate now.' : `Queued. Still blocked: ${r.remaining.blockers.join('; ')}`)
        await refetchRow(person.pid)
      }
    } catch (e) {
      setQueueNote(e instanceof Error ? e.message : 'Could not queue this.')
    } finally { setBusy(null) }
  }, [person?.pid, tenant, refetchRow])

  const doSkip = useCallback(async () => {
    if (!person?.pid) return
    setBusy('skip'); setSkipNote(null)
    try {
      await skipAction(tenant, person.pid)
      setSkipNote(tenant === 'ivan' ? 'Removed from the send line.' : 'Skipped — the sender now excludes this row.')
      await refetchRow(person.pid)
    } catch (e) {
      setSkipNote(e instanceof Error ? e.message : 'Could not skip this.')
    } finally { setBusy(null) }
  }, [person?.pid, tenant, refetchRow])

  const doAddToLane = useCallback(async (campaign: OrbitLane) => {
    if (!person) return
    setBusy('lane'); setLaneNote(null)
    try {
      const r = await addToLane({ tenant, person, campaignId: campaign.id, post: null })
      setLaneNote(r.already
        ? `Already a prospect on another campaign — use Open thread instead (row ${r.prospectId.slice(0, 8)}…).`
        : addToLaneSuccessNote(tenant))
      setLanePickerOpen(false)
    } catch (e) {
      setLaneNote(e instanceof Error ? e.message : 'Could not add this.')
    } finally { setBusy(null) }
  }, [person, tenant])

  const candidateLanes = useMemo(() => pickableLanes(lanes), [lanes])
  const events = detail?.events ?? (person ? person.ev.map(e => ({ ...e, src: '', pid: null })) : [])

  return (
    <>
      <div className="a-orbit-scrim" data-open={open ? '' : undefined} onClick={onClose} />
      <div className="a-orbit-panel" data-open={open ? '' : undefined} role="dialog" aria-label={person ? `${person.n}` : 'Person'}>
        {person ? (
          <>
            <div className="a-orbit-panel-head">
              <div className="a-orbit-panel-head-t">
                <div className="a-orbit-panel-name">{person.n}</div>
                <div className="a-orbit-panel-sub">
                  {[person.ti, person.c].filter(Boolean).join(' · ') || 'No headline on file'}
                </div>
                <div className="a-orbit-panel-sub">
                  ICP {person.i ?? '—'} · {laneRow?.name ?? (person.pid ? 'campaign unknown' : 'no campaign — content touch only')}
                </div>
              </div>
              <IconButton icon="close" label="Close" onClick={onClose} />
            </div>

            <div className="a-orbit-panel-body">
              <section className="a-orbit-ladder">
                {STAGE_LABEL.map((label, i) => (
                  <div
                    key={label}
                    className="a-orbit-ladder-row"
                    data-reached={person.sd[i] ? '' : undefined}
                    data-current={person.st === i ? '' : undefined}
                  >
                    <span className="a-orbit-ladder-dot" />
                    <span className="a-orbit-ladder-label">{label}</span>
                    <span className="a-orbit-ladder-date">{person.sd[i] ? relAge(person.sd[i]) : '—'}</span>
                  </div>
                ))}
              </section>

              <section className="a-orbit-actions">
                <div className="a-orbit-action">
                  <div className="a-orbit-action-effect">Open thread — jumps to the DM conversation. Read-only, writes nothing.</div>
                  <Chip tone="neutral" onClick={person.pid ? openThread : undefined}>
                    {person.pid ? 'Open thread' : 'No thread yet'}
                  </Chip>
                </div>

                {person.pid ? (
                  <div className="a-orbit-action">
                    <div className="a-orbit-action-effect">{queueInviteEffect(tenant)}</div>
                    {pick && !pick.ok ? (
                      <div className="a-orbit-action-blockers">Blocked: {pick.blockers.join('; ')}</div>
                    ) : null}
                    <Chip tone="accent" onClick={busy === null ? doQueue : undefined}>
                      {busy === 'queue' ? 'Queuing…' : 'Queue invite'}
                    </Chip>
                    {queueNote ? <div className="a-orbit-action-note">{queueNote}</div> : null}
                  </div>
                ) : null}

                {person.pid ? (
                  <div className="a-orbit-action">
                    <div className="a-orbit-action-effect">{skipEffect(tenant)}</div>
                    <Chip tone="neutral" onClick={busy === null ? doSkip : undefined}>
                      {busy === 'skip' ? 'Skipping…' : 'Skip'}
                    </Chip>
                    {skipNote ? <div className="a-orbit-action-note">{skipNote}</div> : null}
                  </div>
                ) : null}

                <div className="a-orbit-action">
                  <div className="a-orbit-action-effect">
                    {lanePickerOpen ? 'Pick a campaign (active, never a cold lane):' : 'Adds them to a campaign you pick. They become a lead the engine can work.'}
                  </div>
                  {!lanePickerOpen ? (
                    <Chip tone="neutral" onClick={() => setLanePickerOpen(true)}>Add to lane</Chip>
                  ) : (
                    <div className="a-orbit-lane-pick">
                      {candidateLanes.length === 0 ? <div className="a-orbit-action-blockers">No active non-cold campaign for this tenant.</div> : null}
                      {candidateLanes.map(l => (
                        <Chip key={l.id} tone="neutral" onClick={busy === null ? () => doAddToLane(l) : undefined} title={addToLaneEffect(tenant, l.name)}>
                          {l.name}
                        </Chip>
                      ))}
                      <Chip tone="quiet" onClick={() => setLanePickerOpen(false)}>Cancel</Chip>
                    </div>
                  )}
                  {laneNote ? <div className="a-orbit-action-note">{laneNote}</div> : null}
                </div>
              </section>

              <section>
                <div className="a-orbit-panel-sub" style={{ marginBottom: 8 }}>History</div>
                {detailError ? <div className="a-orbit-action-blockers">{detailError}</div> : null}
                <div className="a-orbit-events">
                  {events.length === 0 ? <div className="a-orbit-event-text">No events in this window.</div> : null}
                  {events.slice(0, 40).map((e, i) => (
                    <div key={i} className="a-orbit-event" data-dir={INBOUND_KINDS.has(e.t) ? 'in' : 'out'}>
                      <span className="a-orbit-event-mark" />
                      <div className="a-orbit-event-body">
                        <span className="a-orbit-event-kind">{e.t}</span>
                        <span className="a-orbit-event-date">{relAge(e.d)}</span>
                        {e.x ? <div className="a-orbit-event-text">{e.x}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
