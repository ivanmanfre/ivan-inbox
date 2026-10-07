// `?`: the DMs keys, as today's shortcut sheet lists them.
import { Sheet } from '../ui/Sheet'

const KEYS: [string, string][] = [
  ['j / k', 'Next / previous conversation'], ['Enter', 'Open it'], ['x', 'Select it'], ['shift x', 'Select the range from the last x'],
  ['/', 'Search every message on every seat'], ['Esc', 'Close the conversation'], ['⌘K', 'Commands: Push to later, Select all, Go'],
  ['⌘J', 'Ask Claude'], ['⌘↩', 'Send what you typed (asks first)'], ['?', 'This sheet'],
]

// Brief 4 (skin section `dms`) adds these; every one goes through the same guards and confirms.
const V4_KEYS: [string, string][] = [
  ['1 / 2 / 3', 'Your seat / Rise / Arch'], ['e', 'Edit the draft'], ['r', 'Write a reply yourself'], ['⌘↩ in the draft', 'Send the draft (asks first)'],
]

export function KeySheet({ onClose, v4 = false }: { onClose: () => void; v4?: boolean }) {
  const keys = v4 ? [...KEYS.slice(0, -1), ...V4_KEYS, KEYS[KEYS.length - 1]] : KEYS
  return (
    <Sheet open onClose={onClose} title="Keys" sub="DMs">
      <div className="dm-ctx dm-keysheet"><dl>{keys.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
    </Sheet>
  )
}
