import type { PlaceProps } from '../places'
import { NotBuilt } from '../ui/NotBuilt'

// PLACEHOLDER. The dms page agent replaces this file with the real page
// (default export, PlaceProps). Until then the place says so honestly.
export default function DmsPage(props: PlaceProps) {
  return <NotBuilt place="dms" layout={props.layout} />
}
