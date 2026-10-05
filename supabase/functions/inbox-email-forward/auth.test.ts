import { expect, it, vi } from 'vitest'
import { checkForwardUser } from './auth.ts'

it('keeps an auth outage separate from an invalid login', async () => {
  const auth = { getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 503, code: 'unexpected_failure' } })) }
  expect(await checkForwardUser(auth, 'valid-token', 'owner')).toEqual({ status: 503, error: 'Login verification is temporarily unavailable. The forward was not sent. Try again.' })
  expect(auth.getUser).toHaveBeenCalledWith('valid-token')
})

it('fails closed on network errors without telling the user to sign in', async () => {
  const auth = { getUser: vi.fn(async () => { throw new TypeError('fetch failed') }) }
  expect((await checkForwardUser(auth, 'valid-token', 'owner'))?.status).toBe(503)
})

it('rejects missing or invalid sessions and other users', async () => {
  const auth = { getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 403, code: 'bad_jwt' } })) }
  expect((await checkForwardUser(auth, '', 'owner'))?.status).toBe(401)
  expect(auth.getUser).not.toHaveBeenCalled()
  expect((await checkForwardUser(auth, 'invalid', 'owner'))?.status).toBe(401)
  const other = { getUser: vi.fn(async () => ({ data: { user: { id: 'other' } }, error: null })) }
  expect((await checkForwardUser(other, 'valid', 'owner'))?.status).toBe(403)
})

it('accepts only the verified inbox owner', async () => {
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: 'owner' } }, error: null })) }
  expect(await checkForwardUser(auth, 'valid', 'owner')).toBeNull()
})
