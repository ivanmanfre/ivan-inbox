import type { PlaceProps } from '../places'
import { ClaudeWorkspace } from './v4/ClaudeWorkspace'

export default function ClaudePage({ layout, route }: PlaceProps) {
  return <ClaudeWorkspace layout={layout} route={route} />
}
