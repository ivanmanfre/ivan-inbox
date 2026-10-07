// Brief 4 Claude place (SPEC-dms §2.12): the page IS the workspace. Rail 280 (the same Chats list,
// with Claude's thread and its Pushes switch) + the conversation column, which is the drawer itself
// in its page variant, so it reads the ONE ClaudeProvider chat: a turn in flight survives navigation
// exactly as today. The Shell does not draw the drawer column on this place under the flag.
import type { ReactNode } from 'react'
import type { Layout } from '../../places'
import type { DRoute } from '../../route'
import { AnswerRow } from '../../ui/AnswerRow'
import { Btn } from '../../ui/Key'
import { Chats, type useChatList } from '../Chats'
import ClaudeDrawer, { StatusPill } from '../Drawer'

export function ClaudeWorkspace({ layout, route, title, list, onNew }: {
  layout: Layout; route: DRoute; title: ReactNode; list: ReturnType<typeof useChatList>; onNew: () => void
}) {
  return (
    <div className="dcl-page dcl-wsp">
      <AnswerRow title={title} tools={<>
        <StatusPill />
        <span className="dcl-grow" />
        <Btn verb="new-chat" onClick={onNew}>New chat</Btn>
      </>} />
      <div className="dcl-wsp-b">
        <aside className="dcl-rail" aria-label="Chats"><Chats list={list} onPicked={() => {}} /></aside>
        <div className="dcl-wsp-c"><ClaudeDrawer layout={layout} route={route} onClose={() => {}} variant="page" /></div>
      </div>
    </div>
  )
}
