import { Kbd } from '../../../ds/Kbd'
import { Sheet } from '../../ui/Sheet'
const keys = [['j / k', 'Next / previous card'], ['Enter', 'Open it'], ['e', 'Write in the box'], ['⌘↩', 'Approve what is in the box (asks first)'], ['Esc', 'Leave the box'], ['⌘K', 'Commands'], ['?', 'This sheet']]
export function KeySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title="Ops keys"><div className="op4-keysheet">{keys.map(([k, title]) => <div key={k}><Kbd>{k}</Kbd><span>{title}</span></div>)}</div></Sheet>
}
