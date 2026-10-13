/** Keep the sender's existing Subject-line contract; the editor exposes its two fields. */
export function splitEmailDraft(text: string): { subject: string; body: string } {
  const header = text.match(/^[ \t]*(?:\*\*)?Subject:[ \t]*([^\r\n]*)\r?\n(?:\r?\n)?/i)
  if (!header) return { subject: '', body: text }
  return { subject: header[1].replace(/\*\*/g, '').trim(), body: text.slice(header[0].length) }
}

export function emailDraftText(subject: string, body: string): string {
  if (/[\r\n]/.test(subject)) throw new Error('Keep the email subject on one line.')
  return subject.trim() ? `Subject: ${subject.trim()}\n\n${body}` : body
}
