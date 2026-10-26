import { supabase } from './supabase'
import { renderEmailComposition, renderEmailDocument, type EmailComposition } from './emailRichText'
import { splitEmailForSend } from './emailPresentation'
import type { DraftEvidence } from './inbox'

const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v)])) : value
export const sameEmailComposition = (a: unknown, b: unknown) => JSON.stringify(normalize(a ?? null)) === JSON.stringify(normalize(b ?? null))

export function validateEmailComposition(text: string, composition: EmailComposition): void {
  if (composition.source_text !== text) throw new Error('The email formatting changed. Review the email before sending.')
  renderEmailComposition(composition)
  if (renderEmailDocument(composition.body).text.trim() !== splitEmailForSend(text).body.trim()) {
    throw new Error('The email formatting does not match its text. Review the email before sending.')
  }
}

export type SavedEmailComposition = { message_text: string; email_mirror_text: string | null; draft_evidence: DraftEvidence }

/** The full evidence comparison travels in the RPC body, retaining concurrent research and guards. */
export async function saveEmailComposition(id: string, text: string, composition: EmailComposition | null, mirror: boolean,
  expectedText: string, expectedComposition: EmailComposition | null = null): Promise<SavedEmailComposition> {
  if (composition) validateEmailComposition(text, composition)
  const { data: current, error: readError } = await supabase.from('outreach_messages')
    .select('message_text,email_mirror_text,draft_evidence').eq('id', id).single()
  if (readError) throw readError
  const source = mirror ? current.email_mirror_text : current.message_text
  const key = mirror ? 'email_mirror_composition' : 'email_composition'
  const savedComposition = current.draft_evidence?.[key] ?? null
  if ((source !== expectedText && source !== text) || (!sameEmailComposition(savedComposition, expectedComposition) && !sameEmailComposition(savedComposition, composition))) {
    throw new Error('The email draft changed. Refresh before saving.')
  }
  const { data, error } = await supabase.rpc('save_inbox_email_composition', {
    p_message_id: id, p_text: text, p_composition: composition, p_mirror: mirror,
    p_expected_text: source, p_expected_evidence: current.draft_evidence ?? null,
  })
  if (error) throw error
  return data as SavedEmailComposition
}
