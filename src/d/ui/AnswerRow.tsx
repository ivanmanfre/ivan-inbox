import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFrameMaybe } from '../shell/frame'

// THE ANSWER ROW. Every page renders exactly one, first thing:
//
//   <AnswerRow title={<>Needs you: <N v={2} /> yours, <N v={2} /> Mattan's.</>}
//              sub="Rise opens 14:00." tools={<Btn>Orbit</Btn>} />
//
// Desktop: the frame owns the row (so the Commands / Ask Claude keys and the
// bell sit at its right on every place, and the critical tint is the frame's);
// the page's title, sub line and tools are placed into it. Phone: the title
// renders here, at the top of the page under the top bar, and `tools` go to
// the top bar left of the bell.
type Props = { title: ReactNode; sub?: ReactNode; tools?: ReactNode }

export function AnswerRow({ title, sub, tools }: Props) {
  const f = useFrameMaybe()
  const head = (
    <div className="d-at">
      <h1>{title}</h1>
      {sub != null && sub !== '' && <p>{sub}</p>}
    </div>
  )
  const toolNode = tools != null && f?.toolsSlot ? createPortal(tools, f.toolsSlot) : null
  if (f?.layout === 'desktop') {
    return <>{f.titleSlot ? createPortal(head, f.titleSlot) : null}{toolNode}</>
  }
  return <div className="d-pans">{head}{toolNode}</div>
}

/**
 * A number inside an answer line: mono, lime when it is work, dim at zero,
 * "?" when it could not be read (never a guess).
 */
export function N({ v }: { v: number | null | undefined }) {
  if (v == null) return <b className="d-n d-n-unk" title="Could not read this number">?</b>
  return <b className={`d-n${v === 0 ? ' d-n-zero' : ''}`}>{v}</b>
}
