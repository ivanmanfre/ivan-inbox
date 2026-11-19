import { useRef, useState } from 'react'
import type { DraftEvidence, DmDraftFile } from '../../lib/inbox'
import { supabase } from '../../lib/supabase'

export async function changeDraftFile(id: string, expected: string | null, change: File | { action: 'remove'; file_id: string }): Promise<DraftEvidence> {
  let body: FormData | { draft_id: string; action: 'remove'; file_id: string }
  if (change instanceof File) {
    if (!/\.pdf$/i.test(change.name) || change.size > 10 * 1024 * 1024) throw new Error('Choose a PDF up to 10 MB.')
    body = new FormData()
    body.set('draft_id', id)
    if (expected) body.set('file_id', expected)
    body.set('file', change)
  } else {
    body = { draft_id: id, ...change }
  }
  const { data, error } = await supabase.functions.invoke('inbox-dm-draft-file', { body })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error ?? 'Could not save the PDF. Refresh the draft.')
  }
  if (!data?.evidence) throw new Error('Could not confirm the PDF change. Refresh the draft.')
  return data.evidence
}

export function DraftFile({ draftId, file, locked, onChange }: {
  draftId: string
  file: DmDraftFile | null
  locked: boolean
  onChange?: (file: File | { action: 'remove'; file_id: string }) => Promise<void>
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  async function save(change: File | { action: 'remove'; file_id: string }) {
    setError('')
    try { await onChange?.(change) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the attachment.') }
  }
  async function open() {
    if (!file) return
    setError('')
    const { data, error } = await supabase.functions.invoke('inbox-dm-draft-file',
      { body: { action: 'preview', draft_id: draftId, file_id: file.id } })
    if (error || typeof data?.url !== 'string') { setError('Could not open the PDF. Refresh the draft.'); return }
    const url = new URL(data.url, import.meta.env.VITE_SUPABASE_URL)
    if (url.origin !== new URL(import.meta.env.VITE_SUPABASE_URL).origin ||
        !url.pathname.startsWith('/storage/v1/object/sign/inbox-dm-draft-files/')) {
      setError('Could not open the PDF.')
      return
    }
    const link = document.createElement('a')
    link.href = url.href
    link.download = file.name
    link.click()
  }
  return <div className="dm-meta" aria-label="Draft attachment">
    {file && <><button type="button" className="dm-linkbtn" onClick={() => void open()} disabled={locked}>📎 {file.name}</button> · PDF </>}
    {onChange && <><input ref={picker} type="file" accept=".pdf,application/pdf" hidden aria-label="Select PDF"
      onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void save(selected) }} />
      <button type="button" className="dm-linkbtn" disabled={locked} onClick={() => picker.current?.click()}>{file ? 'Replace PDF' : 'Attach PDF'}</button>
      {file && <> · <button type="button" className="dm-linkbtn" disabled={locked} onClick={() => void save({ action: 'remove', file_id: file.id })}>Remove PDF</button></>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>
}
