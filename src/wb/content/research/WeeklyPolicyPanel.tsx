import { useEffect, useMemo, useState } from 'react'
import { Badge, Button } from '../../../ds'
import { Group } from '../../kit'
import type { ContentLane } from '../../../lib/content'
import type { EditorialClient } from '../../../lib/editorialTypes'
import { adoptEditorialWeeklyPolicy, readEditorialDirection } from '../../../lib/editorialDirection'
import { buildWeeklySlotManifest, mergeWeeklyPolicy, validateWeeklyPolicy } from '../../../lib/editorialWeeklyPolicy'
import type { FormatPreference, WeeklyPolicy } from '../../../lib/editorialWeeklyPolicy'
import './research.css'

const splitLines = (text: string) => text.split('\n').map(x => x.trim()).filter(Boolean)
const joinLines = (items: string[]) => items.join('\n')
const weekMonday = () => {
  const now = new Date()
  const day = (now.getUTCDay() + 6) % 7
  now.setUTCDate(now.getUTCDate() - day)
  return now.toISOString().slice(0, 10)
}
const emptyPolicy = (): WeeklyPolicy => ({
  schema_version: 1, status: 'proposed', weekly_total: 0,
  allocation: { unit: 'count', values: {} }, format_preferences: [],
  topic_priorities: [], exclusions: [], campaign_dates: [],
  target_outcomes: {}, conflict_priority: [],
  evidence: { source_ids: [], observed_at: '', rationale: '' },
})
const uid = () => `weekly-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const formatNames = ['text', 'single_image', 'carousel', 'video', 'lm_promo', 'resource']

function TextLines({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (items: string[]) => void; hint?: string }) {
  const [draft, setDraft] = useState(joinLines(value))
  useEffect(() => setDraft(joinLines(value)), [value.join('\u0000')])
  return <label className="a-research-reason">{label}<textarea value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => onChange(splitLines(draft))} placeholder={hint} /></label>
}

export function WeeklyPolicyPanel({ lane, client, onSaved, onDirtyChange }: { lane: ContentLane; client: EditorialClient; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [read, setRead] = useState<Awaited<ReturnType<typeof readEditorialDirection>> | null>(null)
  const [policy, setPolicy] = useState<WeeklyPolicy>(emptyPolicy)
  const [weekStart, setWeekStart] = useState(weekMonday)
  const [source, setSource] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [newPurpose, setNewPurpose] = useState('')
  const load = async () => {
    setLoading(true); setMessage(null)
    try {
      const next = await readEditorialDirection(client, lane)
      setRead(next)
      const saved = next.direction?.weekly_policy
      if (saved && validateWeeklyPolicy(saved).length === 0) setPolicy(saved as WeeklyPolicy)
      else setPolicy(emptyPolicy())
      setSource(next.source ?? '')
      setDirty(false)
      onDirtyChange?.(false)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Policy could not be read.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [lane, client])
  const patch = (change: Partial<WeeklyPolicy>) => { setDirty(true); onDirtyChange?.(true); setPolicy(value => ({ ...value, ...change, status: 'proposed' })) }
  const errors = useMemo(() => validateWeeklyPolicy(policy), [policy])
  const preview = useMemo(() => {
    if (!read || errors.length) return null
    try { return buildWeeklySlotManifest(lane, read.active_version ?? 'preview-unadopted', weekStart, mergeWeeklyPolicy(read.direction ?? {}, policy)) }
    catch { return null }
  }, [read, policy, errors, lane, weekStart])
  const save = async () => {
    if (!read || errors.length) { setMessage(errors.join('; ') || 'Read the current direction first.'); return }
    if (!source.trim() || !reason.trim()) { setMessage('Source and reason are required before adoption.'); return }
    setBusy(true); setMessage(null)
    try {
      const result = await adoptEditorialWeeklyPolicy(client, lane, read.active_version, policy, source, reason, uid())
      if (result.state === 'conflict') { setMessage(`A newer direction exists (${result.observed_version ?? 'unknown'}). Reload and compare before saving.`); return }
      await load()
      setMessage(`Adopted direction ${result.active_version}. Future briefs use the new version; existing drafts retain their original version link.`)
      onSaved?.()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Policy could not be saved.') }
    finally { setBusy(false) }
  }
  const allocationEntries = Object.entries(policy.allocation.values)
  const setAllocation = (name: string, value: number) => patch({ allocation: { ...policy.allocation, values: { ...policy.allocation.values, [name]: value } } })
  const addPurpose = () => {
    const raw = newPurpose.trim().toLowerCase()
    if (!raw || raw in policy.allocation.values) return
    patch({ allocation: { ...policy.allocation, values: { ...policy.allocation.values, [raw]: 0 } },
      target_outcomes: { ...policy.target_outcomes, [raw]: '' }, conflict_priority: [...policy.conflict_priority, raw] })
    setNewPurpose('')
  }
  const removePurpose = (name: string) => {
    const values = { ...policy.allocation.values }; delete values[name]
    const outcomes = { ...policy.target_outcomes }; delete outcomes[name]
    patch({ allocation: { ...policy.allocation, values }, target_outcomes: outcomes, conflict_priority: policy.conflict_priority.filter(x => x !== name) })
  }
  const setFormat = (index: number, change: Partial<FormatPreference>) => patch({ format_preferences: policy.format_preferences.map((item, i) => i === index ? { ...item, ...change } : item) })
  return <Group label="Weekly policy" tail={read && <Badge tone={read.direction?.weekly_policy && !dirty ? 'accent' : 'neutral'} variant="ring">{dirty ? 'Proposed edit' : read.direction?.weekly_policy ? String((read.direction.weekly_policy as WeeklyPolicy).status) : 'Unspecified'}</Badge>} pad>
    <p className="a-ct-sub">A proposed edit only changes the preview. Adopt saves a new client direction version for future briefs. Private Notes remain disconnected.</p>
    {loading ? <p className="a-ct-sub">Reading current direction…</p> : <>
      {!read?.direction?.weekly_policy && <p className="a-ct-sub">No weekly policy is adopted. Existing legacy week behavior remains in place until this proposal is adopted.</p>}
      <p className="a-ct-sub">Current direction {read?.active_version ?? 'unadopted'} · source {read?.source ?? 'unknown'} · updated {read?.updated_at ?? 'unknown'}. {policy.evidence.observed_at ? `Policy evidence observed ${policy.evidence.observed_at}.` : 'Policy evidence date unknown.'}</p>
      <div className="a-policy-top"><label className="a-research-reason">Weekly total<input aria-label="Weekly total" type="number" min="0" value={policy.weekly_total} onChange={e => patch({ weekly_total: Math.max(0, Number(e.target.value) || 0) })} /></label><label className="a-research-reason">Preview week starting<input aria-label="Preview week starting" type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} /></label><label className="a-research-reason">Allocation method<select aria-label="Allocation method" value={policy.allocation.unit} onChange={e => patch({ allocation: { ...policy.allocation, unit: e.target.value as 'count' | 'proportion' } })}><option value="count">Exact counts</option><option value="proportion">Proportions</option></select></label></div>
      <div className="a-policy-section"><div className="a-policy-heading"><strong>Purpose allocation</strong><div className="a-research-actions"><input aria-label="New purpose" className="a-policy-add-input" value={newPurpose} onChange={e => setNewPurpose(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPurpose() } }} placeholder="Purpose name" /><Button size="sm" variant="quiet" onClick={addPurpose}>Add purpose</Button></div></div><p className="a-ct-sub">Purposes decide what each slot is for. Format capacity is set separately below.</p>{allocationEntries.length === 0 && <p className="a-ct-sub">No purposes set. A zero-post week is valid.</p>}{allocationEntries.map(([name, value]) => <div className="a-policy-purpose" key={name}><span className="a-policy-purpose-name">{name}</span><label className="a-research-reason">{policy.allocation.unit === 'count' ? 'Slots' : 'Weight'}<input aria-label={`${name} ${policy.allocation.unit === 'count' ? 'slots' : 'weight'}`} type="number" min="0" step={policy.allocation.unit === 'count' ? 1 : 0.1} value={value} onChange={e => setAllocation(name, Number(e.target.value) || 0)} /></label><label className="a-research-reason">Desired outcome<input aria-label={`${name} desired outcome`} value={policy.target_outcomes[name] ?? ''} onChange={e => patch({ target_outcomes: { ...policy.target_outcomes, [name]: e.target.value } })} placeholder="What this purpose should change" /></label><Button size="sm" variant="quiet" onClick={() => removePurpose(name)}>Remove</Button></div>)}</div>
      <div className="a-policy-section"><div className="a-policy-heading"><strong>Format capacity</strong><Button size="sm" variant="quiet" onClick={() => patch({ format_preferences: [...policy.format_preferences, { format: 'text', max_slots: 1 }] })}>Add format</Button></div><p className="a-ct-sub">A video or carousel serves one purpose slot. Adding a format never adds a post.</p>{policy.format_preferences.map((item, i) => <div className="a-policy-format" key={i}><label className="a-research-reason">Format<select aria-label={`Format ${i + 1}`} value={item.format} onChange={e => setFormat(i, { format: e.target.value })}>{[...new Set([item.format, ...formatNames])].map(x => <option key={x} value={x}>{x.replaceAll('_', ' ')}</option>)}</select></label><label className="a-research-reason">Maximum slots<input aria-label={`${item.format} maximum slots`} type="number" min="0" value={item.max_slots} onChange={e => setFormat(i, { max_slots: Number(e.target.value) || 0 })} /></label><label className="a-research-reason">For purposes (comma separated)<input aria-label={`${item.format} purposes`} value={(item.purposes ?? []).join(', ')} onChange={e => setFormat(i, { purposes: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="Any purpose" /></label><label className="a-research-reason">Asset or production gap<input aria-label={`${item.format} asset gap`} value={item.asset_gap ?? ''} onChange={e => setFormat(i, { asset_gap: e.target.value || undefined })} /></label><label className="a-policy-check"><input type="checkbox" checked={item.route_ready === true} onChange={e => setFormat(i, { route_ready: e.target.checked })} /> Route ready</label><Button size="sm" variant="quiet" onClick={() => patch({ format_preferences: policy.format_preferences.filter((_, n) => n !== i) })}>Remove</Button></div>)}</div>
      <div className="a-policy-section"><TextLines label="Topic priorities (one per line)" value={policy.topic_priorities} onChange={x => patch({ topic_priorities: x })} /><TextLines label="Exclusions (one per line)" value={policy.exclusions} onChange={x => patch({ exclusions: x })} /><TextLines label="Campaign dates (one per line)" value={policy.campaign_dates} onChange={x => patch({ campaign_dates: x })} hint="2026-10-01: campaign name; leave empty if unknown" /></div>
      <div className="a-policy-section"><div className="a-policy-heading"><strong>Week override</strong><label className="a-policy-check"><input type="checkbox" checked={!!policy.week_override} onChange={e => patch({ week_override: e.target.checked ? { week_start: weekStart, expires_after: weekStart, weekly_total: policy.weekly_total, allocation: structuredClone(policy.allocation) } : undefined })} /> Use an override</label></div>{policy.week_override && <><div className="a-policy-top"><label className="a-research-reason">Starts<input type="date" value={policy.week_override.week_start} onChange={e => patch({ week_override: { ...policy.week_override!, week_start: e.target.value } })} /></label><label className="a-research-reason">Expires after<input type="date" value={policy.week_override.expires_after} onChange={e => patch({ week_override: { ...policy.week_override!, expires_after: e.target.value } })} /></label><label className="a-research-reason">Override total<input type="number" min="0" value={policy.week_override.weekly_total} onChange={e => patch({ week_override: { ...policy.week_override!, weekly_total: Number(e.target.value) || 0 } })} /></label></div>{Object.entries(policy.week_override.allocation.values).map(([name, value]) => <label className="a-research-reason" key={name}>Override {name}<input type="number" min="0" value={value} onChange={e => patch({ week_override: { ...policy.week_override!, allocation: { ...policy.week_override!.allocation, values: { ...policy.week_override!.allocation.values, [name]: Number(e.target.value) || 0 } } } })} /></label>)}</>}</div>
      <div className="a-policy-section"><Button size="sm" variant="quiet" onClick={() => setShowAdvanced(x => !x)}>{showAdvanced ? 'Hide' : 'Show'} objectives and evidence</Button>{showAdvanced && <><label className="a-research-reason">Objective<textarea value={policy.objective ?? ''} onChange={e => patch({ objective: e.target.value })} /></label><label className="a-research-reason">Audience<input value={policy.audience ?? ''} onChange={e => patch({ audience: e.target.value })} /></label><label className="a-research-reason">Offer<input value={policy.offer ?? ''} onChange={e => patch({ offer: e.target.value })} /></label><label className="a-research-reason">Positioning<input value={policy.positioning ?? ''} onChange={e => patch({ positioning: e.target.value })} /></label><label className="a-research-reason">Audience maturity<input value={policy.audience_maturity?.state ?? ''} onChange={e => patch({ audience_maturity: { state: e.target.value, source_ids: policy.audience_maturity?.source_ids ?? [], reviewed_at: policy.audience_maturity?.reviewed_at ?? policy.evidence.observed_at } })} /></label><TextLines label="Conflict priority, first purpose first" value={policy.conflict_priority} onChange={x => patch({ conflict_priority: x })} /><TextLines label="Evidence source IDs" value={policy.evidence.source_ids} onChange={x => patch({ evidence: { ...policy.evidence, source_ids: x } })} /><label className="a-research-reason">Evidence observed on<input type="date" value={policy.evidence.observed_at} onChange={e => patch({ evidence: { ...policy.evidence, observed_at: e.target.value } })} /></label><label className="a-research-reason">Policy rationale<textarea value={policy.evidence.rationale} onChange={e => patch({ evidence: { ...policy.evidence, rationale: e.target.value } })} /></label></>}</div>
      <div className="a-policy-preview"><div className="a-policy-heading"><strong>Slot preview</strong><span className="a-ct-sub">{preview ? `${preview.slots.length} of ${policy.weekly_total} slots · ${preview.policy_status}` : 'Resolve checks to preview'}</span></div>{errors.length > 0 && <ul className="a-policy-errors" role="alert">{errors.map(x => <li key={x}>{x}</li>)}</ul>}{preview && (preview.slots.length ? <ol className="a-policy-slots">{preview.slots.map(slot => <li key={slot.slot_id}><b>{slot.ordinal}. {slot.purpose}</b><span>{slot.format.replaceAll('_', ' ')} · {slot.route_ready ? 'route ready' : 'route unverified'}{slot.asset_gap ? ` · needs ${slot.asset_gap}` : ''}</span></li>)}</ol> : <p className="a-ct-sub">Paused week: no slots, jobs, or active-client proof credit.</p>)}</div>
      <div className="a-policy-save"><label className="a-research-reason">Decision source<input value={source} onChange={e => setSource(e.target.value)} placeholder="Source ID or dated client instruction" /></label><label className="a-research-reason">Why adopt this version<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for this change" /></label><div className="a-research-actions"><Button size="sm" disabled={busy || errors.length > 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Adopt weekly policy'}</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => void load()}>Reload saved</Button></div></div>
      {message && <p className="a-ct-sub" role="status">{message}</p>}
    </>}
  </Group>
}
