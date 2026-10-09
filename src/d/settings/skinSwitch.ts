// The one Brief 4 switch (SPEC-dms §0.1, §2.13): a per-device rollback, not a choice put to Ivan.
// Off stores 'off' in localStorage['ds-skin'] (skin.ts step 3), so this device keeps today's look
// whatever the defaults say; On removes it, back to the verified defaults. Then the page reloads,
// because the skin is resolved once before React mounts.
import { SKIN_KEY, skinSet } from '../../ds/skin'

export const skinOnHere = (): boolean => skinSet().size > 0 && (typeof document === 'undefined' || !document.documentElement.hasAttribute('data-phone-oxygen-off'))
export function storedSkinOff(): boolean {
  try { return localStorage.getItem(SKIN_KEY) === 'off' } catch { return false }
}
export function setSkinHere(on: boolean, reload: () => void = () => window.location.reload()) {
  try {
    if (on) localStorage.removeItem(SKIN_KEY); else localStorage.setItem(SKIN_KEY, 'off')
    sessionStorage.removeItem(SKIN_KEY)
  } catch { /* private mode: this session only */ }
  reload()
}
