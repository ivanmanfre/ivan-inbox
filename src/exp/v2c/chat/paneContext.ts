// What the Claude pane is allowed to see, and what it actually sends.
//
// THE DEFECT THIS FIXES. The pane was a general chat. It knew the LABEL of the
// peer beside it (Shell.tsx passed `aboutLabel`, one prospect name) and nothing
// else, so "why did these fail" or "summarise this thread" meant copying rows
// out of the app and pasting them back into a box that sits next to them.
//
// THE RULE THIS FILE ENFORCES, and the reason it is a separate pure module
// rather than a few lines inside ChatPane: an assistant that silently reads
// your screen is worse than one that does not. So every subject is
//
//   1. NAMED on screen as a chip, so nothing travels unannounced,
//   2. REMOVABLE, so he can turn any of it off, including all of it,
//   3. SHALLOW BY DEFAULT. A subject carries identifiers, counts, states and
//      dates. Message bodies and draft bodies are real content about real
//      people; they travel only when he switches that one chip to full text,
//      and the chip says which it is doing.
//
// Everything here is pure and takes data the app has already fetched. It opens
// no request, so attaching context can never cost a round trip and can never
// cost a model call.

import { label } from '../../../lib/labels'

// One more rule, added after the label purge landed on wb/polish: the block is
// PRINTED to Ivan behind the "show me what travels" toggle, so it is rendered
// UI and obeys the same law the rest of the app now obeys. No raw column
// names, no SCREAMING_SNAKE verdict codes, no bare row ids. States go through
// lib/labels, lanes arrive already named by the caller, and an id is carried in
// the short form the cards already print.

export type SeeKind = 'lane' | 'thread' | 'draft' | 'selection'

/** The short id every card in this app prints, and the only form that travels. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/** One thing on screen the pane may carry. */
export type Subject = {
  /** Stable across renders, because the detach memory is keyed on it. */
  key: string
  kind: SeeKind
  /** What the chip prints. Plain words, no column names. */
  label: string
  /**
   * Identifiers, counts, state and dates. NEVER a message body or a draft
   * body: `redacts` below is the test seam that pins that.
   */
  summary: string
  /** The bodies, when this subject has any. Absent means there is nothing deeper. */
  full?: string
  /** How many bodies `full` would carry. Printed on the chip so the cost is legible. */
  bodies?: number
}

/** Which chips he has turned off, and which he has opened up. */
export type SeeState = { off: string[]; deep: string[] }

export const EMPTY_SEE: SeeState = { off: [], deep: [] }

export function isOff(s: SeeState, key: string): boolean { return s.off.includes(key) }
export function isDeep(s: SeeState, key: string): boolean { return s.deep.includes(key) }

export function toggleOff(s: SeeState, key: string): SeeState {
  return isOff(s, key)
    ? { ...s, off: s.off.filter(k => k !== key) }
    : { off: [...s.off, key], deep: s.deep.filter(k => k !== key) }
}

export function toggleDeep(s: SeeState, key: string): SeeState {
  return isDeep(s, key)
    ? { ...s, deep: s.deep.filter(k => k !== key) }
    : { ...s, deep: [...s.deep, key] }
}

/** Detach everything currently on screen. One click, and the pane sees nothing. */
export function offAll(s: SeeState, subjects: Subject[]): SeeState {
  return { off: [...new Set([...s.off, ...subjects.map(x => x.key)])], deep: [] }
}

export function onAll(s: SeeState, subjects: Subject[]): SeeState {
  const here = new Set(subjects.map(x => x.key))
  return { ...s, off: s.off.filter(k => !here.has(k)) }
}

export function attached(subjects: Subject[], s: SeeState): Subject[] {
  return subjects.filter(x => !isOff(s, x.key))
}

// ---------------------------------------------------------------------------
// The block that travels
// ---------------------------------------------------------------------------

const OPENER
  = 'What Ivan has attached from his screen. He picked these and can remove any of them, '
  + 'so treat this as the current view and not as the whole database.'

/**
 * The exact text that rides with the next turn, or undefined when nothing is
 * attached. Rendered verbatim in the pane behind the "show me" toggle, because
 * the only honest way to say what leaves the browser is to print it.
 */
export function buildSeeBlock(subjects: Subject[], s: SeeState): string | undefined {
  const on = attached(subjects, s)
  if (on.length === 0) return undefined
  const lines = on.map(x => {
    const deep = isDeep(s, x.key) && x.full
    const head = `- ${x.summary}`
    if (!deep) {
      return x.bodies
        ? `${head}\n  (${x.bodies === 1 ? 'the text itself was' : 'the texts themselves were'} not attached)`
        : head
    }
    return `${head}\n${indent(x.full!)}`
  })
  return [OPENER, ...lines].join('\n')
}

function indent(body: string): string {
  return body.split('\n').map(l => `  ${l}`).join('\n')
}

/** One sentence for the strip header, so the state is readable without opening anything. */
export function seeLine(subjects: Subject[], s: SeeState): string {
  const on = attached(subjects, s)
  if (subjects.length === 0) return 'Nothing on screen to attach yet'
  if (on.length === 0) return 'Claude cannot see your screen'
  const deep = on.filter(x => isDeep(s, x.key) && x.full).length
  const noun = on.length === 1 ? 'thing' : 'things'
  return deep === 0
    ? `Claude can see ${on.length} ${noun}, names and states only`
    : `Claude can see ${on.length} ${noun}, ${deep} with the full text`
}

// ---------------------------------------------------------------------------
// The builders. One per kind, each fed data the app already holds.
// ---------------------------------------------------------------------------

export function laneSubject(jobLabel: string, laneLabel: string): Subject {
  return {
    key: 'lane',
    kind: 'lane',
    label: `${jobLabel}, ${laneLabel}`,
    summary: `He is on the ${jobLabel} screen, in ${laneLabel}.`,
  }
}

export type ThreadLike = {
  prospect_id: string
  prospect_name: string
  prospect_company?: string | null
  stage?: string
  channel?: string
  messages: { direction?: string | null; created_at?: string | null; message_text?: string | null }[]
  hasPendingDraft?: boolean
}

const THREAD_MSGS = 12
const MSG_CHARS = 700

export function threadSubject(t: ThreadLike, laneLabel: string, now = Date.now()): Subject {
  const inbound = [...t.messages].reverse().find(m => m.direction === 'inbound')
  const last = t.messages[t.messages.length - 1]
  const waiting = inbound && last && last.direction === 'inbound' && inbound.created_at
    ? daysSince(inbound.created_at, now)
    : null
  const bits = [
    `Open conversation with ${t.prospect_name}`,
    t.prospect_company ? `at ${t.prospect_company}` : null,
    `(${laneLabel}, ${shortId(t.prospect_id)}${t.channel ? `, ${label(t.channel)}` : ''}${t.stage ? `, ${label(t.stage)}` : ''}).`,
    `${t.messages.length} messages.`,
    waiting !== null ? `They replied last and have been waiting ${waiting} days.` : 'He replied last.',
    t.hasPendingDraft ? 'A reply draft is waiting for his approval.' : null,
  ].filter(Boolean)
  const body = t.messages.slice(-THREAD_MSGS).map(m => {
    const who = m.direction === 'inbound' ? t.prospect_name : 'Ivan'
    const when = m.created_at ? m.created_at.slice(0, 10) : 'undated'
    return `${when} ${who}: ${clip(m.message_text ?? '', MSG_CHARS)}`
  }).join('\n')
  return {
    key: `thread:${t.prospect_id}`,
    kind: 'thread',
    label: t.prospect_name,
    summary: bits.join(' '),
    full: body || undefined,
    bodies: Math.min(t.messages.length, THREAD_MSGS) || undefined,
  }
}

export type DraftLike = {
  id: string
  title?: string | null
  topic?: string | null
  status?: string | null
  type?: string | null
  scheduled_at?: string | null
  updated_at?: string | null
  qa_verdict?: string | null
  qa_score?: string | number | null
  post_body?: string | null
}

const BODY_CHARS = 4000

export function draftSubject(d: DraftLike, laneLabel: string, now = Date.now()): Subject {
  const bits = [
    `Open draft "${clip(d.title || d.topic || 'untitled', 120)}"`,
    `(${shortId(d.id)}, ${laneLabel}${d.type ? `, ${label(d.type)}` : ''}, ${d.status ? label(d.status) : 'state unknown'}).`,
    d.updated_at ? `Last changed ${daysSince(d.updated_at, now)} days ago.` : null,
    d.scheduled_at ? `Carries a date of ${d.scheduled_at.slice(0, 10)}.` : 'Has no date.',
    d.qa_verdict ? `The quality check said ${label(d.qa_verdict)}${d.qa_score != null ? ` at ${d.qa_score}` : ''}.` : null,
    d.post_body ? null : 'The row holds no text at all.',
  ].filter(Boolean)
  return {
    key: `draft:${d.id}`,
    kind: 'draft',
    label: clip(d.title || d.topic || 'this draft', 40),
    summary: bits.join(' '),
    full: d.post_body ? clip(d.post_body, BODY_CHARS) : undefined,
    bodies: d.post_body ? 1 : undefined,
  }
}

/** `lane` arrives already NAMED (LANE_LABEL), never as the database value. */
export type SelectedLike = { id: string; kind: string; label: string; lane?: string }

const KIND_NOUN: Record<string, [string, string]> = {
  draft: ['draft', 'drafts'],
  magnet: ['lead magnet', 'lead magnets'],
  thread: ['conversation', 'conversations'],
}

const SEL_NAMED = 25

/**
 * The picked rows. This subject has NO deep form on purpose: a selection can be
 * fifty rows, and "send me the bodies of fifty drafts" is not a question anyone
 * asks by accident. He can open one row and attach that instead.
 */
export function selectionSubject(rows: SelectedLike[]): Subject | null {
  if (rows.length === 0) return null
  const kinds = new Map<string, number>()
  for (const r of rows) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1)
  const shape = [...kinds.entries()].map(([k, n]) => {
    const nouns = KIND_NOUN[k] ?? [k, `${k}s`]
    return `${n} ${n === 1 ? nouns[0] : nouns[1]}`
  }).join(' and ')
  const named = rows.slice(0, SEL_NAMED)
  const list = named.map(r => `${r.label} (${shortId(r.id)}${r.lane ? `, ${r.lane}` : ''})`).join('; ')
  const more = rows.length > named.length ? ` and ${rows.length - named.length} more` : ''
  return {
    key: 'selection',
    kind: 'selection',
    label: `${rows.length} picked`,
    summary: `He has ${shape} selected: ${list}${more}. Names and ids only, no text.`,
  }
}

// ---------------------------------------------------------------------------

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}

function daysSince(iso: string, now: number): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.round((now - t) / 86_400_000))
}

/**
 * Test seam, and the reason the summary/full split is a data shape rather than
 * a convention: a summary that leaked a body would be a privacy defect that no
 * screenshot would ever show. Returns the bodies a subject's SHALLOW form
 * failed to keep out.
 */
export function leakedBodies(subject: Subject, bodies: string[]): string[] {
  const hay = subject.summary.toLowerCase()
  return bodies.filter(b => {
    const probe = b.replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase()
    return probe.length >= 12 && hay.includes(probe)
  })
}
