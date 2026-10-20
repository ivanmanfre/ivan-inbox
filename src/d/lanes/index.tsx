import type { PlaceProps } from '../places'
import V4 from './v4/LanesV4'
import './phone-ox.css'

export default function Page(props: PlaceProps) {
  return <V4 {...props} />
}
