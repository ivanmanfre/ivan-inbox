import { emailDraftText, splitEmailDraft } from '../../lib/emailSubject'
import { emailDetails } from '../../lib/emailPresentation'
// The draft on the tape (mock `.tape`), its email leg (`.df-leg`, Send both), the mirror email
// rider, and the warnings today's card carries (held, email check failed, you already replied).
// The tape IS the editor: typing saves (useAutosave); Send sends what is in it.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { draftSendVia, type DraftSendVia, emailRowSender, emailSenderLabel, eventTime, holdReason, isFollowUp, isSwishdmReply, messageChannel, operatorWords, type Thread } from '../../lib/inbox'
import { DIcon } from '../ui/icons'
import { warsawHm } from '../ui/time'
import { Explain } from './Explain'
import { ago } from './model'
import { dayMonth } from './threadRows'
import type { Edits } from './verbs'
import type { SaveState } from './useAutosave'
import { EmailCcField, EmailDraftEditor } from './EmailDraftEditor'

const SCAN_DELIVERY_MODEL = 'rise_dm2_scan_delivery_v1'

export function paras(text: string): string[] {
  return text.split(/^[ \t]*-{3,}[ \t\r]*$|\n\n+/m).map(s => s.trim()).filter(Boolean)
}

function legPipe(t: Thread): string {
  const c = t.companionDraft ? messageChannel(t.companionDraft) : null
  return c === 'email' ? ' + email' : c === 'inmail' ? ' + InMail' : c ? ' + DM' : ''
}

/** The draft editor box. `autosave={false}` for a box that saves only on a key (the held-message edit):
 *  an update reload then treats it as typed-in, unsaved work. */
export function Grow({ value, onChange, label, onBlur, max = 240, onKeyDown, autosave = true, rows = 2 }: { value: string; onChange: (s: string) => void; label: string; onBlur?: () => void; max?: number; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void; autosave?: boolean; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`
  }, [value, max])
  return <textarea ref={ref} className="dm-edit" data-autosave={autosave || undefined} aria-label={label} value={value} rows={rows} spellCheck onBlur={onBlur} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} />
}

/** The bubbles of a LinkedIn draft, split on the `---` lines the sender splits on. The separators are
 *  kept as they were written, so joinBubbles(splitBubbles(x)) gives back x exactly, and an edit to one
 *  bubble leaves every other boundary untouched. Empty bubbles are kept while he types (the sender
 *  drops them). */
export type Bubbles = { parts: string[]; seps: string[] }
export function splitBubbles(text: string): Bubbles {
  const t = text.split(/(\n?^[ \t]*-{3,}[ \t\r]*$\n?)/m)
  return { parts: t.filter((_, i) => i % 2 === 0), seps: t.filter((_, i) => i % 2 === 1) }
}
// The splitter's `^`/`$` (multiline) treat all four of these as line ends, so the guards do too.
const EOL_START = /^[\n\r\u2028\u2029]/, EOL_END = /[\n\r\u2028\u2029]$/
export function joinBubbles({ parts, seps }: Bubbles): string {
  let out = parts[0] ?? ''
  for (let i = 1; i < parts.length; i++) {
    let sep = seps[i - 1] ?? '\n---\n'
    // A separator written at an edge (no newline on that side) must still sit on its own line once
    // text appears beside it, or the `---` would join the text and the two bubbles would merge.
    if (out !== '' && !EOL_END.test(out) && !EOL_START.test(sep)) sep = '\n' + sep
    if (parts[i] !== '' && !EOL_START.test(parts[i]) && !EOL_END.test(sep)) sep += '\n'
    out += sep + parts[i]
  }
  return out
}
/** Bubble i out, with the separator before it (or after it, for the first). */
export function removeBubble(b: Bubbles, i: number): Bubbles {
  const cut = i === 0 ? 0 : i - 1
  return { parts: b.parts.filter((_, j) => j !== i), seps: b.seps.filter((_, j) => j !== cut) }
}

/** #16: a draft of two or more bubbles is edited bubble by bubble, each with a ✕ that removes it
 *  (21 of his 33 edits on his seat only cut whole bubbles). Same text, same autosave. One bubble is
 *  drawn as one plain box, in the same tree, so typing a `---` line never drops focus: the caret
 *  moves on to the new bubble. */
export function BubbleEdit({ value, onChange, onBlur, label, max, onKeyDown }: { value: string; onChange: (s: string) => void; onBlur?: () => void; label: string; max: number; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const focusNext = useRef<{ i: number; at: number } | null>(null)
  const b = splitBubbles(value)
  const n = b.parts.length
  useEffect(() => {
    const f = focusNext.current
    if (f == null) return
    focusNext.current = null
    const el = box.current?.querySelectorAll<HTMLTextAreaElement>('textarea.dm-edit')[f.i]
    if (el) { el.focus(); const at = Math.min(f.at, el.value.length); el.setSelectionRange(at, at) }
  }, [value])
  const edit = (i: number, text: string) => {
    const inner = splitBubbles(text)
    // He typed a `---` line inside bubble i: it becomes two (or more) bubbles; the caret follows to the
    // same place in the text (inside a separator = the start of the bubble after it).
    if (inner.parts.length > 1) {
      const el = document.activeElement
      const caret = el instanceof HTMLTextAreaElement ? el.selectionStart : text.length
      let off = 0, k = 0, at = 0
      for (; k < inner.parts.length; k++) {
        const end = off + inner.parts[k].length
        if (caret <= end) { at = caret - off; break }
        off = end + (inner.seps[k]?.length ?? 0)
        if (caret < off) { k++; at = 0; break }
      }
      focusNext.current = { i: i + Math.min(k, inner.parts.length - 1), at }
    }
    onChange(joinBubbles({ parts: [...b.parts.slice(0, i), ...inner.parts, ...b.parts.slice(i + 1)], seps: [...b.seps.slice(0, i), ...inner.seps, ...b.seps.slice(i)] }))
  }
  return <div ref={box} className={n > 1 ? 'dm-bubs' : 'dm-bubs dm-bubs-1'} role={n > 1 ? 'group' : undefined} aria-label={n > 1 ? `${label}, ${n} bubbles` : undefined}>
    {b.parts.map((p, i) => <div key={i} className="dm-bub-ed">
      <Grow value={p} onChange={s => edit(i, s)} onBlur={onBlur}
        label={i === 0 ? label : `${label}, bubble ${i + 1}`} max={max} onKeyDown={onKeyDown} rows={n > 1 ? 1 : 2} />
      {n > 1 && <button type="button" className="dm-bub-x" data-verb="remove-bubble" aria-label={`Remove bubble ${i + 1}`} title="Remove this bubble"
        onClick={() => onChange(joinBubbles(removeBubble(b, i)))}>✕</button>}
    </div>)}
  </div>
}

function EmailEdit({ value, onChange, label, subjectLabel = 'Email subject', fixedSubject, onBlur, max = 360, onKeyDown }: {
  value: string; onChange: (text: string) => void; label: string; subjectLabel?: string; fixedSubject?: string; onBlur: () => void; max?: number; onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}) {
  const { subject, body } = splitEmailDraft(value)
  return <>
    <div className="dm-email-cc dm-email-subject"><label>Subject <input aria-label={subjectLabel} type="text" autoComplete="off" data-autosave value={fixedSubject ?? subject} readOnly={fixedSubject !== undefined} placeholder={subjectLabel === 'InMail subject' ? 'Add an InMail subject' : 'Add an email subject'}
      onChange={e => onChange(emailDraftText(e.target.value, body))} onBlur={onBlur} onKeyDown={onKeyDown} /></label></div>
    <Grow value={body} onChange={text => onChange(emailDraftText(subject, text))} onBlur={onBlur} label={label} max={max} onKeyDown={onKeyDown} />
  </>
}

const SAVE_WORD: Record<SaveState, string> = { idle: '', saving: 'Saving…', saved: 'Saved', failed: 'Not saved' }

/** The draft is the last bubble of the conversation, on our side, and it IS the editor (Ivan 09-27:
 *  "I want the direct editing capabilities"): type in it, it saves itself (useAutosave). Its email
 *  leg and the mirror email edit the same way. */
export function Draft({ t, edits, setEdits, save, onBlur, onRetrySave, now, onRetry, v4 = false, strips, foot, onSend, onSendVia, deliveryBusy = false, emailLoading = false, emailUnavailable = false, phone = false }: {
  t: Thread; edits: Edits; setEdits: (e: Edits) => void; save: SaveState; onBlur: () => void; onRetrySave: () => void; now: number; onRetry: () => void
  /** #16: on desktop the draft box grows to fit (no inner scroll); the phone keeps the 240px cap. */
  phone?: boolean
  /** Brief 4: one card, the editor (SPEC-dms §2.4.5): caveats attached as strips, Why in the foot. */
  v4?: boolean; strips?: ReactNode; foot?: ReactNode
  /** Brief 4: ⌘↩ in the draft runs the SAME send (its confirm always opens first). */
  onSendVia?: (mode: DraftSendVia) => void; deliveryBusy?: boolean
  onSend?: () => void
  emailLoading?: boolean; emailUnavailable?: boolean
}) {
  const draft = t.draft
  if (!draft) return null
  const comp = t.companionDraft
  const grow = phone ? 240 : 100_000
  // Ivan 10-21 (Barak Zuman): a send check that holds his own edited reply returns it here. It is his
  // text, not an "AI draft": say so, and when it was held.
  const words = draft.send_blocked_at ? operatorWords(draft) : null
  const heldAt = draft.send_blocked_at ? ` · held ${warsawHm(draft.send_blocked_at)}` : ''
  const title = t.draftSnoozedUntil ? `Later: back ${dayMonth(t.draftSnoozedUntil)}`
    : words === 'own' ? `Your message${heldAt}` : words === 'approved' ? `AI draft you approved${heldAt}`
    : t.draftStale ? 'AI draft · you already replied'
      : isSwishdmReply(draft) ? 'SwishDM reply for Jonathan\u2019s seat' : isFollowUp(draft) ? 'AI follow-up' : 'AI draft'
  const email = messageChannel(draft) === 'email'
  const inmail = messageChannel(draft) === 'inmail'
  // The Open Profile sender supplies this fixed subject outside the stored body.
  const fixedSubject = inmail && t.client_id === 'ivan' && ['template/ivan_openprofile_v3', 'template/ivan_openprofile_reviewed_v2'].includes(draft.ai_model ?? '') ? 'your LinkedIn' : undefined
  const rider = (draft.recipient_email || draft.email_delivery_recipient) && !email && (draft.email_mirror_text || draft.ai_model === SCAN_DELIVERY_MODEL)
  const mode = draftSendVia(draft)
  const emailEnabled = mode !== 'dm' && !!draft.recipient_email
  const emailChoice = <label className="dm-email-choice">Send via <select aria-label="Send via" value={mode}
    disabled={deliveryBusy || draft.email_stamp_unavailable || !onSendVia}
    onChange={e => onSendVia?.(e.target.value as DraftSendVia)}>
    <option value="dm">DM only</option>
    <option value="email" disabled={!draft.email_mirror_text?.trim() || !['ivan','arch','risedtc'].includes(t.client_id)}>Email only</option>
    <option value="both">DM + email</option>
  </select>{deliveryBusy && <span role="status">Saving…</span>}</label>
  const hold = holdReason(draft)
  const sendKey = onSend ? (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend() } } : undefined
  const envelope = emailDetails(draft, t)
  const emailDisabled = emailLoading || emailUnavailable
  const mainEmail = <EmailDraftEditor value={edits.main} onChange={main => setEdits({ ...edits, main, mainComposition: null })} composition={edits.mainComposition}
    onRichChange={(main, mainComposition) => setEdits({ ...edits, main, mainComposition })} label="The draft" subject="Quick question"
    from={envelope.from ?? 'Sender unavailable'} to={envelope.to.join(', ') || null} cc={edits.cc ?? ''} onCcChange={cc => setEdits({ ...edits, cc })} onBlur={onBlur} onKeyDown={sendKey} disabled={emailDisabled} />
  const compEnvelope = comp ? emailDetails(comp, t) : null
  const companionEmail = comp && <EmailDraftEditor value={edits.companion ?? ''} onChange={companion => setEdits({ ...edits, companion, companionComposition: null })} composition={edits.companionComposition}
    onRichChange={(companion, companionComposition) => setEdits({ ...edits, companion, companionComposition })} label="The other leg" subjectLabel="Email leg subject" subject="Quick question"
    from={compEnvelope?.from ?? 'Sender unavailable'} to={compEnvelope?.to.join(', ') || null} cc={edits.companionCc ?? ''} ccLabel="Email leg CC recipients" onCcChange={companionCc => setEdits({ ...edits, companionCc })} onBlur={onBlur} onKeyDown={sendKey} disabled={emailDisabled} />
  const mirrorEmail = <EmailDraftEditor transport="mirror" value={edits.email ?? ''} onChange={email => setEdits({ ...edits, email, emailComposition: null })} composition={edits.emailComposition}
    onRichChange={(email, emailComposition) => setEdits({ ...edits, email, emailComposition })} label="The email that goes with it" subject={`Your ${t.prospect_company || 'your store'} growth scan`}
    from={emailSenderLabel(t.client_id).match(/\(from (.+)\)/)?.[1] ?? 'Sender unavailable'} to={draft.recipient_email ?? null} cc={edits.cc ?? ''} onCcChange={cc => setEdits({ ...edits, cc })} onBlur={onBlur} onKeyDown={sendKey} disabled={emailDisabled} />
  const generatedEnvelope = !draft.email_mirror_text && <div className="dm-email-sheet"><div className="dm-email-edit-fields">
    <div className="dm-email-field"><span className="dm-email-field-name">From</span><span>{emailSenderLabel(t.client_id).match(/\(from (.+)\)/)?.[1] ?? 'Sender unavailable'}</span></div>
    <div className="dm-email-field"><span className="dm-email-field-name">To</span><span>{draft.recipient_email}</span></div>
    <EmailCcField value={edits.cc ?? ''} onChange={cc => setEdits({ ...edits, cc })} onBlur={onBlur} />
  </div></div>
  const emailReadNotice = emailLoading ? <p className="dm-email-error" role="status">Loading email details before editing.</p>
    : emailUnavailable ? <p className="dm-email-error" role="alert">Email details are unavailable. Refresh before editing.</p> : null
  if (v4) {
    const caveats = t.draftStale || hold || draft.email_stamp_unavailable || strips
    return (
      <div className={`dx-card${t.draftStale ? ' dx-card-stale' : ''}`}>
        <div className="dx-card-h">
          <span className="dx-card-t"><b className="dm-b-dl">Draft</b> {title}{legPipe(t)} · {ago(eventTime(draft), now)} ago</span>
          <span className="dx-card-pen" aria-hidden="true">✎</span>
          <span key={save} className={`dm-save dm-save-${save}`} role="status" aria-live="polite">
            {SAVE_WORD[save]}{save === 'failed' && <> · <button type="button" className="dm-linkbtn" data-verb="autosave-retry" onClick={onRetrySave}>Retry</button></>}
          </span>
        </div>
        {caveats && <div className="dx-strips">
          {t.draftStale && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />You already replied after their last message.</b><p>This draft is probably not needed.</p></div>}
          {hold && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />{hold}</b></div>}
          {draft.email_stamp_unavailable && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />Could not check whether this draft also sends an email.</b><p>Refresh before you approve.</p></div>}
          {strips}
        </div>}
        {emailReadNotice}
        {rider && <div className="dx-card-b dm-send-via">{emailChoice}</div>}
        {mode !== 'email' || email ? <div className={email ? 'dm-native-email-draft dx-card-b' : 'dm-b-draft dm-tape dx-card-b'} data-draft={draft.id}
          onClick={e => { if (!(e.target as HTMLElement).closest('textarea,input,button,a')) e.currentTarget.querySelector<HTMLTextAreaElement>('textarea.dm-edit')?.focus() }}>
          {inmail && <p className="dm-meta">InMail to {t.prospect_name}</p>}
          {email ? mainEmail : inmail ? <EmailEdit subjectLabel="InMail subject" fixedSubject={fixedSubject} value={edits.main} onChange={main => setEdits({ ...edits, main })} onBlur={onBlur} label="The draft" onKeyDown={sendKey} />
            : <BubbleEdit value={edits.main} onChange={main => setEdits({ ...edits, main })} onBlur={onBlur} label="The draft" max={grow} onKeyDown={sendKey} />}
        </div> : null}
        {comp && (
          <div className={`dm-leg dx-leg${messageChannel(comp) === 'email' ? ' dm-email-leg' : ''}`}>
            {messageChannel(comp) !== 'email' && <div className="dm-tm">
              <span>{messageChannel(comp) === 'email' ? `Email leg${comp.recipient_email ? ` · to ${comp.recipient_email}` : ''}` : 'LinkedIn DM leg'}</span>
              <span>{messageChannel(comp) === 'email' ? `from ${emailRowSender(t.client_id)}` : 'rides with the draft'}</span>
            </div>}
            {messageChannel(comp) === 'email' ? companionEmail
              : <BubbleEdit value={edits.companion ?? ''} onChange={companion => setEdits({ ...edits, companion })} onBlur={onBlur} label="The other leg" max={phone ? 360 : grow} onKeyDown={sendKey} />}
            <Explain inset v4 messageId={comp.id} messageText={comp.message_text} editedText={edits.companion ?? comp.message_text}
              evidence={comp.draft_evidence} unavailable={comp.draft_evidence_unavailable} onRetry={onRetry} />
          </div>
        )}
        {rider && (
          <div className="dm-leg dm-leg-rider dx-leg dm-email-leg">
            {!emailEnabled && <p className="dm-email-envelope">Only the LinkedIn DM will be sent.</p>}
            {emailEnabled && <>
            <div className="dm-tm">
              <span>{draft.email_mirror_text && mode !== 'email' && !emailSenderLabel(t.client_id)
                ? `This email does not send from your seat, only the DM goes. Copy it into Gmail to ${draft.recipient_email} if you want it sent.`
                : draft.email_mirror_text ? `${mode === 'email' ? 'Approving sends' : 'Approving also sends'} this email to ${draft.recipient_email}${mode === 'email' ? ` (from ${emailRowSender(t.client_id)})` : emailSenderLabel(t.client_id)}`
                  : `Approving also emails the scan link to ${draft.recipient_email}${emailSenderLabel(t.client_id)}. The sender writes that email itself.`}</span>
            </div>
            {generatedEnvelope}
            {draft.email_mirror_text && <>
              {mirrorEmail}
              <Explain inset v4 messageId={`${draft.id}:email`} messageText={draft.email_mirror_text} editedText={edits.email ?? draft.email_mirror_text}
                evidence={draft.draft_evidence?.email} unavailable={draft.draft_evidence_unavailable} onRetry={onRetry} />
            </>}
            </>}
          </div>
        )}
        {foot != null && <div className="dx-card-f">{foot}</div>}
      </div>
    )
  }
  return (
    <>
      {t.draftStale && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />You already replied after their last message.</b><p>This draft is probably not needed.</p></div>}
      {hold && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />{hold}</b></div>}
      {draft.email_stamp_unavailable && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />Could not check whether this draft also sends an email.</b><p>Refresh before you approve.</p></div>}
      {emailReadNotice}
      {rider && emailChoice}
      {mode !== 'email' || email ? <div className={email ? 'dm-native-email-draft' : 'dm-b dm-b-out dm-b-draft dm-tape'} data-draft={draft.id}>
        <div className="dm-tm">
          <span><b className="dm-b-dl">Draft</b> {title}{legPipe(t)} · {ago(eventTime(draft), now)} ago</span>
          <span className={`dm-save dm-save-${save}`} role="status" aria-live="polite">
            {SAVE_WORD[save]}{save === 'failed' && <> · <button type="button" className="dm-linkbtn" data-verb="autosave-retry" onClick={onRetrySave}>Retry</button></>}
          </span>
        </div>
        {inmail && <p className="dm-meta">InMail to {t.prospect_name}</p>}
        {email ? mainEmail : inmail ? <EmailEdit subjectLabel="InMail subject" fixedSubject={fixedSubject} value={edits.main} onChange={main => setEdits({ ...edits, main })} onBlur={onBlur} label="The draft" />
          : <BubbleEdit value={edits.main} onChange={main => setEdits({ ...edits, main })} onBlur={onBlur} label="The draft" max={grow} />}
      </div> : null}
      {comp && (
        <div className={`dm-leg${messageChannel(comp) === 'email' ? ' dm-email-leg' : ''}`}>
          {messageChannel(comp) !== 'email' && <div className="dm-tm">
            <span>{messageChannel(comp) === 'email' ? `Email leg${comp.recipient_email ? ` · to ${comp.recipient_email}` : ''}` : 'LinkedIn DM leg'}</span>
            <span>{messageChannel(comp) === 'email' ? `from ${emailRowSender(t.client_id)}` : 'rides with the draft'}</span>
          </div>}
          {messageChannel(comp) === 'email' ? companionEmail
            : <BubbleEdit value={edits.companion ?? ''} onChange={companion => setEdits({ ...edits, companion })} onBlur={onBlur} label="The other leg" max={phone ? 360 : grow} />}
          <Explain inset messageId={comp.id} messageText={comp.message_text} editedText={edits.companion ?? comp.message_text}
            evidence={comp.draft_evidence} unavailable={comp.draft_evidence_unavailable} onRetry={onRetry} />
        </div>
      )}
      {rider && (
        <div className="dm-leg dm-leg-rider dm-email-leg">
            {!emailEnabled && <p className="dm-email-envelope">Only the LinkedIn DM will be sent.</p>}
            {emailEnabled && <>
          <div className="dm-tm">
            <span>{draft.email_mirror_text && mode !== 'email' && !emailSenderLabel(t.client_id)
              ? `This email does not send from your seat, only the DM goes. Copy it into Gmail to ${draft.recipient_email} if you want it sent.`
              : draft.email_mirror_text ? `${mode === 'email' ? 'Approving sends' : 'Approving also sends'} this email to ${draft.recipient_email}${mode === 'email' ? ` (from ${emailRowSender(t.client_id)})` : emailSenderLabel(t.client_id)}`
                : `Approving also emails the scan link to ${draft.recipient_email}${emailSenderLabel(t.client_id)}. The sender writes that email itself.`}</span>
          </div>
          {generatedEnvelope}
          {draft.email_mirror_text && <>
            {mirrorEmail}
            <Explain inset messageId={`${draft.id}:email`} messageText={draft.email_mirror_text} editedText={edits.email ?? draft.email_mirror_text}
              evidence={draft.draft_evidence?.email} unavailable={draft.draft_evidence_unavailable} onRetry={onRetry} />
          </>}
          </>}
        </div>
      )}
    </>
  )
}
