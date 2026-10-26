import { emailDraftText } from './emailSubject'
import { splitEmailForSend } from './emailPresentation'
import { defaultEmailSignature, plainEmailDocument, renderEmailComposition, renderEmailDocument, stripLegacyEmailSignature, type EmailComposition } from './emailRichText'

/** Import a legacy draft once; current structured edits keep their exact formatting and signature. */
export function buildEmailComposition(value: string, from: string, options: {
  subject?: string | null; transport?: 'native' | 'mirror'; composition?: EmailComposition | null
} = {}): EmailComposition {
  const split = splitEmailForSend(value, options)
  if (options.composition) {
    if (options.composition.source_text !== value) throw new Error('Saved email formatting changed. Refresh email details before editing or sending.')
    renderEmailComposition(options.composition)
    if (renderEmailDocument(options.composition.body).text.trim() !== split.body.trim()) throw new Error('The email formatting does not match its text.')
    return options.composition
  }
  const legacy = options.transport === 'mirror' ? split.body : split.body.trim().replace(/\*\*/g, '').split(/^[ \t]*-{3,}[ \t\r]*$/m).map(s => s.trim()).filter(Boolean).join('\n\n')
  const body = plainEmailDocument(stripLegacyEmailSignature(legacy, from))
  return { version: 1, source_text: emailDraftText(split.subject, renderEmailDocument(body).text), body, signature: defaultEmailSignature(from) }
}
