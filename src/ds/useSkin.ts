import { useSyncExternalStore } from 'react'
import { skinHas, subscribeSkin, type Section } from './skin'

/** True while `section` is owned by the brief skin. Call it unconditionally, above any return. */
export function useSkin(section: Section): boolean {
  return useSyncExternalStore(subscribeSkin, () => skinHas(section), () => false)
}
