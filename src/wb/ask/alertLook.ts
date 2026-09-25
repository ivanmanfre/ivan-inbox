/* ==========================================================================
   src/wb/ask/alertLook.ts: how each KIND of alert looks in the feed.

   Ivan, 2026-09-25: "I see the alerts coming with the same emoji. Everything
   looks kind of the same."

   The KIND map (family + severity -> kind) is the one the push payload uses:
   `supabase/functions/_shared/alert-kinds.ts`, re-exported for the client as
   `src/lib/alertKinds.ts`. It is imported, never copied, so the sheet and the
   lock screen always name the same kind.

   What this file adds and the push cannot carry: a drawn glyph (a named ds
   icon, never an emoji), a tile tone and a label, so kinds read apart by
   shape + tone + word before any text is read.
   ========================================================================== */
import type { IconName } from '../../ds'
import { ALERT_KINDS, kindFor, type Kind } from '../../lib/alertKinds'

export type AlertKind = Kind

/** The tile tone. Mapped onto `--ds-*` tokens in claude.css, never a literal here. */
export type AlertTone = 'attention' | 'urgent' | 'clear' | 'ink' | 'ring' | 'outline' | 'quiet'

export interface AlertLook {
  readonly label: string
  readonly icon: IconName
  readonly tone: AlertTone
  /** Routine kinds fold into one group at the end of the sheet. */
  readonly routine: boolean
}

const DRAWN: Record<AlertKind, Omit<AlertLook, 'label'>> = {
  needs_you: { icon: 'person', tone: 'attention', routine: false },
  failed: { icon: 'alert', tone: 'urgent', routine: false },
  reply: { icon: 'dms', tone: 'ink', routine: false },
  booking: { icon: 'calendar', tone: 'ring', routine: false },
  reminder: { icon: 'time', tone: 'outline', routine: false },
  done: { icon: 'approve', tone: 'clear', routine: false },
  seen: { icon: 'eye', tone: 'quiet', routine: false },
  digest: { icon: 'list', tone: 'quiet', routine: true },
}

/** Label from the shared map (the push says the same word), glyph and tone drawn here. */
export const ALERT_LOOK = Object.fromEntries(
  (Object.keys(DRAWN) as AlertKind[]).map(k => [k, { label: ALERT_KINDS[k].label, ...DRAWN[k] }]),
) as Record<AlertKind, AlertLook>

/** The kind for one row: the push payload's own resolver. Severity 'error' always wins. */
export function kindOf(family: string, severity: string | null | undefined): AlertKind {
  const sev = severity === 'error' || severity === 'attention' ? severity : 'info'
  return kindFor(family, sev)
}

export function lookOf(family: string, severity: string | null | undefined): AlertLook & { kind: AlertKind } {
  const kind = kindOf(family, severity)
  return { kind, ...ALERT_LOOK[kind] }
}
