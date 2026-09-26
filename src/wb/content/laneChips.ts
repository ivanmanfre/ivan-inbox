import { LANE_SHORT, type ContentLane } from '../../lib/content'
import type { Lane } from '../../lib/markets'

// The client switch on Magnets, Styles and Strategy, in the chip names the
// rebuild ruled (Ivan / Rise / Arch, sentence case). A client the code does
// not know yet keeps its registry name, so a fourth tenant still shows.
export function clientOptions(lanes: Lane[]): Array<{ id: string; label: string }> {
  return lanes.map(l => ({ id: l.client_id, label: LANE_SHORT[l.client_id as ContentLane] ?? l.display_name }))
}
