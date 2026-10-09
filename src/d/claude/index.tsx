import type { PlaceProps } from '../places'
import { useFrame } from '../shell/frame'
import { AnswerRow, N } from '../ui/AnswerRow'
import { Btn } from '../ui/Key'
import { useClaude } from './ClaudeProvider'
import { Chats, useChatList } from './Chats'
import { useSkin } from '../../ds/useSkin'
import { ClaudeWorkspace } from './v4/ClaudeWorkspace'
import './claude.css'
import './phone-ox.css'

// The Claude place (`#exp/d/claude`, and today's `#exp/brain-b/ask?thread=&turn=`
// push links, which map here). The page is the chats list; the conversation
// is the ⌘J drawer, which ClaudeProvider opens on arrival (and on the push
// link's thread and turn). Hooks first; no early return.

export default function ClaudePage({ layout, route }: PlaceProps) {
  const f = useFrame()
  const { chat } = useClaude()
  const list = useChatList()
  // Brief 4 (`claude` section): a plain value picking the view at the final return.
  const v4 = useSkin('claude')
  const n = list.threads ? list.threads.filter(t => t.kind === 'ask').length : null
  const title = <>Claude: <N v={list.failed ? null : n} /> chats{chat.botThread ? ", plus Claude's thread." : '.'}</>
  // Phone: the helper sentence is cut; "Claude is working on your last ask." (a state) stays.
  const sub = chat.busy ? 'Claude is working on your last ask.' : layout === 'phone' ? undefined : 'Pick a chat and it opens in the drawer. Asking never sends a DM.'
  if (v4 && layout === 'desktop') return <ClaudeWorkspace layout={layout} route={route} title={title} list={list} onNew={() => chat.newThread()} />
  return (
    <div className={`dcl-page dcl-page-${layout}`}>
      <AnswerRow title={title} sub={sub} tools={
        <Btn verb="new-chat" onClick={() => { chat.newThread(); f.setClaudeOpen(true) }}>New chat</Btn>
      } />
      <div className="dcl-page-b">
        <Chats list={list} onPicked={() => f.setClaudeOpen(true)} />
      </div>
    </div>
  )
}
