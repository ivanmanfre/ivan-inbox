// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import fixture from '../../lib/cc-fixtures/rate_limited.json'
import { isContractError, parsePayload, type CcPayload } from '../../lib/campaignControl'
import { renderInFrame } from '../test-utils'
import { ACK_KEY } from './ack'
import { ControlCell, TodayCell } from './seatCells'
import type { LanesData } from './useLanesData'

afterEach(() => { cleanup(); localStorage.clear() })

const parsed = parsePayload(fixture)
if (isContractError(parsed)) throw new Error(parsed.contract_error)
const p: CcPayload = parsed
const slot = <T,>(value: T | null, failed: string | null = null) => ({ value, failed })
function data(over: Partial<LanesData> = {}): LanesData {
  return {
    cc: slot(p), perf: slot([]), gov: slot([]), outcomes: slot([]), pipeline: slot([]), replacement: slot([]), viewed: slot([]),
    counters: slot([]), inbound: slot([]), cameBack: slot([]), warm: slot(0), engagers: slot({ ivan: 0, risedtc: 0, arch: 0 }),
    health: slot(null), pauses: slot({}), ...over,
  }
}
const NOW = Date.parse(p.as_of)

describe('Control cell', () => {
  it('Acknowledge flips a local flag, says "not recovered", and sends nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderInFrame(<ControlCell seat="ivan" ctx={{ d: data(), now: NOW }} />)
    const key = document.querySelector('[data-verb="acknowledge"]') as HTMLButtonElement
    expect(key).not.toBeNull()
    expect(key.disabled).toBe(false)
    fireEvent.click(key)
    expect(screen.getByText(/Acknowledged, not recovered/)).toBeTruthy()
    expect((document.querySelector('[data-verb="acknowledge"]') as HTMLButtonElement).disabled).toBe(true)
    expect(Object.keys(JSON.parse(localStorage.getItem(ACK_KEY) ?? '{}'))).toHaveLength(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('a remembered acknowledgement survives a remount', () => {
    renderInFrame(<ControlCell seat="arch" ctx={{ d: data(), now: NOW }} />)
    fireEvent.click(document.querySelector('[data-verb="acknowledge"]')!)
    cleanup()
    renderInFrame(<ControlCell seat="arch" ctx={{ d: data(), now: NOW }} />)
    expect((document.querySelector('[data-verb="acknowledge"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a failed monitor read says so instead of drawing a calm seat', () => {
    renderInFrame(<ControlCell seat="ivan" ctx={{ d: data({ cc: slot(null, 'boom') }), now: NOW }} />)
    expect(screen.getByText(/could not be read: boom/)).toBeTruthy()
    expect(document.querySelector('[data-verb="acknowledge"]')).toBeNull()
  })
})

describe('Today cell', () => {
  it('prints "?" for figures it could not read and "cap unknown" when the counter read failed', () => {
    renderInFrame(<TodayCell seat="ivan" ctx={{ d: data({ cc: slot(null, 'x'), counters: slot(null, 'y'), gov: slot(null, 'z') }), now: NOW }} />)
    expect(screen.getAllByText('?')).toHaveLength(3)
    expect(screen.getByText('cap unknown')).toBeTruthy()
    expect(screen.getByText(/Governor could not be read/)).toBeTruthy()
  })
})
