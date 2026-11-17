// The files a LinkedIn message carried, under its words: a picture shows as a thumbnail, anything else
// as a chip with its name, type and size. A tap opens it (a new tab; on the phone, the system viewer).
// A file LinkedIn no longer serves keeps its chip and says so; it opens nothing.
import { useState } from 'react'
import { FileText, Film, Image as ImageIcon, Mic } from 'lucide-react'
import { fileName, fileSize, fileType, type DmFile } from '../../lib/dmAttachments'

const ICON = { image: ImageIcon, video: Film, audio: Mic, file: FileText } as const

function Chip({ f }: { f: DmFile }) {
  const Icon = ICON[f.kind]
  const name = fileName(f)
  const meta = [fileType(f), fileSize(f.size), f.unavailable ? 'no longer on LinkedIn' : null].filter(Boolean).join(' · ')
  const inner = <>
    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
    <span className="dm-file-t"><b>{name}</b><small>{meta}</small></span>
  </>
  if (!f.href || f.unavailable) return <span className="dm-file dm-file-off" data-file={f.id} data-kind={f.kind}>{inner}</span>
  return <a className="dm-file" href={f.href} target="_blank" rel="noreferrer" data-verb="open-file" data-file={f.id} data-kind={f.kind} aria-label={`Open ${name}, ${meta}`}>{inner}</a>
}

/** A picture shows itself. One the browser cannot draw (a HEIC, a failed read) falls back to its chip. */
function Thumb({ f }: { f: DmFile }) {
  const [failed, setFailed] = useState(false)
  if (f.kind !== 'image' || !f.href || f.unavailable || failed) return <Chip f={f} />
  // The box is sized before the picture loads, so the thread does not jump under the reader.
  const ratio = f.width && f.height ? `${f.width} / ${f.height}` : undefined
  return (
    <a className="dm-file-img" href={f.href} target="_blank" rel="noreferrer" data-verb="open-file" data-file={f.id} data-kind="image" aria-label={`Open ${fileName(f)}`} style={ratio ? { aspectRatio: ratio } : undefined}>
      <img src={f.href} alt={f.name ?? 'Image sent on LinkedIn'} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </a>
  )
}

export function Attachments({ files }: { files: readonly DmFile[] }) {
  if (!files.length) return null
  return (
    <div className="dm-files" data-files={files.length}>
      {files.map(f => <Thumb key={f.id} f={f} />)}
    </div>
  )
}
