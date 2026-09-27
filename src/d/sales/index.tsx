import type { PlaceProps } from '../places'
import { NotBuilt } from '../ui/NotBuilt'

// PLACEHOLDER. The sales page agent replaces this file with the real page
// (default export, PlaceProps). Until then the place says so honestly.
export default function SalesPage(props: PlaceProps) {
  return <NotBuilt place="sales" layout={props.layout} />
}
