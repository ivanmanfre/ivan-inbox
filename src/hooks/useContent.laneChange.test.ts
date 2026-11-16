import { expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: {} }))
import { changeTouchesLane } from './useContent'

const held = new Set(['held-1'])
it('a change in another lane does not re-read this one', () => {
  expect(changeTouchesLane('ivan', { new: { id: 'x', client_id: 'arch' }, old: { id: 'x' } }, held)).toBe(false)
  expect(changeTouchesLane('arch', { new: { id: 'x', client_id: null }, old: { id: 'x' } }, held)).toBe(false)
  expect(changeTouchesLane('risedtc', { new: { id: 'x', client_id: 'swishdm' }, old: {} }, held)).toBe(false)
})
it('a change in this lane, or to a row this lane holds, re-reads it', () => {
  expect(changeTouchesLane('ivan', { new: { id: 'x', client_id: null } }, held)).toBe(true)
  expect(changeTouchesLane('ivan', { new: { id: 'x', client_id: 'ivan' } }, held)).toBe(true)
  expect(changeTouchesLane('arch', { new: { id: 'x', client_id: 'arch' } }, held)).toBe(true)
  // moved out of the lane, or deleted (old carries only the key)
  expect(changeTouchesLane('ivan', { new: { id: 'held-1', client_id: 'arch' }, old: { id: 'held-1' } }, held)).toBe(true)
  expect(changeTouchesLane('ivan', { new: {}, old: { id: 'held-1' } }, held)).toBe(true)
})
it('a delete of a row this lane does not hold leaves it alone', () => {
  expect(changeTouchesLane('ivan', { new: {}, old: { id: 'other' } }, held)).toBe(false)
})
it('a row whose lane the payload does not carry re-reads to be safe', () => {
  expect(changeTouchesLane('arch', { new: { id: 'x', status: 'review' }, old: { id: 'x' } }, held)).toBe(true)
})
