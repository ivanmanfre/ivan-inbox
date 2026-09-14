import { describe, it, expect } from 'vitest'
import { bootGate } from './bootGate'

describe('bootGate', () => {
  it('paints the app before auth resolves when a session sits in storage', () => {
    expect(bootGate({ ready: false, hasSession: false, storedUser: true })).toBe('app')
  })
  it('paints nothing before auth resolves when storage holds no session', () => {
    expect(bootGate({ ready: false, hasSession: false, storedUser: false })).toBe('blank')
  })
  it('keeps the app once auth resolves with a session', () => {
    expect(bootGate({ ready: true, hasSession: true, storedUser: true })).toBe('app')
  })
  it('falls to login when auth resolves without a session, even if storage had one', () => {
    expect(bootGate({ ready: true, hasSession: false, storedUser: true })).toBe('login')
  })
})
