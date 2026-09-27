// `?`: the DMs keys, as today's shortcut sheet lists them.
import { Sheet } from '../ui/Sheet'

const KEYS: [string, string][] = [
  ['j / k', 'Next / previous conversation'], ['Enter', 'Open it'], ['x', 'Select it'], ['shift x', 'Select the range from the last x'],
  ['/', 'Search every message on every seat'], ['Esc', 'Close the conversation'], ['⌘K', 'Commands: Push to later, Select all, Go'],
  ['⌘J', 'Ask Claude'], ['⌘↩', 'Send what you typed (asks first)'], ['?', 'This sheet'],
]

export function KeySheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Keys" sub="DMs">
      <div className="dm-ctx dm-keysheet"><dl>{KEYS.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
    </Sheet>
  )
}
