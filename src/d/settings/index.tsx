import type { PlaceProps } from '../places'
import { NotBuilt } from '../ui/NotBuilt'

// PLACEHOLDER. The settings page agent replaces this file with the real page
// (default export, PlaceProps). Until then the place says so honestly.
export default function SettingsPage(props: PlaceProps) {
  return <NotBuilt place="settings" layout={props.layout} />
}
