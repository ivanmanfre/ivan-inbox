export const BUCKET = 'inbox-dm-draft-files'
export const MAX_BYTES = 10 * 1024 * 1024
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export type Attachment = { id: string; name: string; size: number; sha256: string }

export function validAttachment(file: unknown): file is Attachment {
  const a = file as Attachment | null
  return !!a && typeof a.id === 'string' && UUID.test(a.id) && typeof a.name === 'string' &&
    /^[^\p{Cc}\p{Cf}/\\"]{1,179}\.pdf$/iu.test(a.name) && Number.isInteger(a.size) &&
    a.size > 5 && a.size <= MAX_BYTES && typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/.test(a.sha256)
}

export function objectName(draftId: string, fileId: string) {
  return `${draftId}/${fileId}.pdf`
}

export async function pdfInfo(blob: Blob) {
  if (blob.size <= 5 || blob.size > MAX_BYTES || await blob.slice(0, 5).text() !== '%PDF-') {
    throw new Error('Choose a PDF under 10 MB.')
  }
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return { size: blob.size, sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') }
}

export async function providerForm(text: string, accountId: string, file: Attachment, bytes: Blob) {
  if (!validAttachment(file)) throw new Error('Invalid PDF attachment.')
  const actual = await pdfInfo(bytes)
  if (actual.size !== file.size || actual.sha256 !== file.sha256) throw new Error('The PDF changed after approval.')
  const form = new FormData()
  form.set('text', text)
  form.set('account_id', accountId)
  form.append('attachments', bytes.slice(0, bytes.size, 'application/pdf'), file.name)
  return form
}
