import type { PlaceProps } from '../places'
import { NotBuilt } from '../ui/NotBuilt'

// PLACEHOLDER. The content page agent replaces this file with the real page
// (default export, PlaceProps). Until then the place says so honestly.
export default function ContentPage(props: PlaceProps) {
  return <NotBuilt place="content" layout={props.layout} />
}
