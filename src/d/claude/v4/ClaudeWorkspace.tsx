import type { ReactNode } from 'react'
import type { Layout } from '../../places'
import type { DRoute } from '../../route'
import { AnswerRow } from '../../ui/AnswerRow'
import { Btn } from '../../ui/Key'
import ClaudeDrawer, { StatusPill } from '../Drawer'

export function ClaudeWorkspace({ layout, route, title, onNew }: {
  layout: Layout; route: DRoute; title: ReactNode; onNew: () => void
}) {
  return (
    <div className="dcl-page dcl-wsp">
      <AnswerRow title={title} tools={<>
        <StatusPill />
        <span className="dcl-grow" />
        <Btn verb="new-chat" onClick={onNew}>New chat</Btn>
      </>} />
      <div className="dcl-wsp-b" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        <div className="dcl-wsp-c"><ClaudeDrawer layout={layout} route={route} onClose={() => {}} variant="page" /></div>
      </div>
    </div>
  )
}
