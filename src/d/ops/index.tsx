import type { PlaceProps } from '../places'
import { NotBuilt } from '../ui/NotBuilt'

// PLACEHOLDER. The ops page agent replaces this file with the real page
// (default export, PlaceProps). Until then the place says so honestly.
export default function OpsPage(props: PlaceProps) {
  return <NotBuilt place="ops" layout={props.layout} />
}
