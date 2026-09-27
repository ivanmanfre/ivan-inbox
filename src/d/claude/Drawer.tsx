import type { Layout } from '../places'
import type { DRoute } from '../route'
import { DIcon } from '../ui/icons'
import { ForeignLink } from '../ui/NotBuilt'

export type ClaudeDrawerProps = {
  layout: Layout
  route: DRoute
  onClose: () => void
}

// PLACEHOLDER. The ⌘J Claude drawer slot. The Claude agent replaces this file
// (default export, ClaudeDrawerProps). The frame mounts it docked right on the
// desktop (below the answer row, beside the page) and as a full sheet from the
// lime dock key on the phone. It stays an honest empty slot until then.
export default function ClaudeDrawer({ onClose }: ClaudeDrawerProps) {
  return (
    <div className="d-cslot">
      <div className="d-cslot-h">
        <b>Claude</b>
        <button type="button" className="d-ib" aria-label="Close Claude (⌘J)" onClick={onClose}><DIcon name="x" /></button>
      </div>
      <div className="d-cslot-b">
        <p>Claude is not built into this preview yet.</p>
        <p className="d-dim">Ask in today's app: <ForeignLink hash="#exp/brain-b/ask">Open Claude</ForeignLink></p>
      </div>
    </div>
  )
}
