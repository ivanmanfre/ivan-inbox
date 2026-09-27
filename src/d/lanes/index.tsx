import type { PlaceProps } from '../places'
import { NotBuilt } from '../ui/NotBuilt'

// PLACEHOLDER. The lanes page agent replaces this file with the real page
// (default export, PlaceProps). Until then the place says so honestly.
export default function LanesPage(props: PlaceProps) {
  return <NotBuilt place="lanes" layout={props.layout} />
}
