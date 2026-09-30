/** Routers ask mounted editors before reading or acting on a new hash. */
export const BEFORE_HASH_NAVIGATION = 'app-before-hash-navigation'
export function hashNavigationAllowed(): boolean {
  return window.dispatchEvent(new Event(BEFORE_HASH_NAVIGATION, { cancelable: true }))
}
