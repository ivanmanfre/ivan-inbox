import type { PlaceProps } from '../places'
import { useSkin } from '../../ds/useSkin'
import V3 from './V3'
import V4 from './v4/SalesV4'
import './phone-ox.css'

export default function Page(props: PlaceProps) {
  const on = useSkin('sales')
  return on ? <V4 {...props} /> : <V3 {...props} />
}
