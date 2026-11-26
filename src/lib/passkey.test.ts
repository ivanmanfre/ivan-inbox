import { afterEach, describe, expect, it } from 'vitest'
import { PASSKEY_FLAG, hasPasskeyFlag, isPasskeyCancel, setPasskeyFlag } from './passkey'

describe('passkey helpers', () => {
  afterEach(() => localStorage.removeItem(PASSKEY_FLAG))

  it('treats a closed Face ID sheet as a cancel, not an error', () => {
    expect(isPasskeyCancel({ code: 'ERROR_CEREMONY_ABORTED' })).toBe(true)
    expect(isPasskeyCancel({ name: 'NotAllowedError' })).toBe(true)
    expect(isPasskeyCancel({ code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: { name: 'NotAllowedError' } })).toBe(true)
    expect(isPasskeyCancel({ message: 'Invalid credential' })).toBe(false)
    expect(isPasskeyCancel(null)).toBe(false)
  })

  it('remembers per device that Face ID is on', () => {
    expect(hasPasskeyFlag()).toBe(false)
    setPasskeyFlag(true)
    expect(hasPasskeyFlag()).toBe(true)
    setPasskeyFlag(false)
    expect(hasPasskeyFlag()).toBe(false)
  })
})
