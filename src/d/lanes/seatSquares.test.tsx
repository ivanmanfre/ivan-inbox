// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderInFrame } from '../test-utils'
import { SeatSquares, seatWarnings } from './SeatSquares'
import type { LanesData } from './useLanesData'

afterEach(() => { cleanup() })

const slot = <T,>(value: T | null, failed: string | null = null) => ({ value, failed })
function data(over: Partial<LanesData> = {}): LanesData {
  const base = Object.fromEntries(['cc', 'perf', 'gov', 'outcomes', 'pipeline', 'replacement', 'viewed', 'counters', 'inbound', 'inboundDaily', 'scans', 'campSends', 'cameBack', 'warm', 'engagers', 'health', 'pauses', 'attempts', 'ready']
    .map(k => [k, slot(null)])) as unknown as LanesData
  return { ...base, ...over }
}
const gov = (client_id: string, daily_used: number) => ({ client_id, daily_used }) as never
const pipe = (client_id: string, sendable: number, sent_7d: number) => ({ client_id, lane: 'x', sendable, sent_7d, sent_30d: 0 })

describe('Lanes 3 seat squares', () => {
  it('the out-of-leads warning sits on that seat only (same rule and rows as the old all-seats line)', () => {
    const d = data({ pipeline: slot([pipe('risedtc', 0, 14), pipe('ivan', 300, 70)]), gov: slot([gov('risedtc', 40), gov('ivan', 10)]) })
    expect(seatWarnings(d, 'risedtc')).toEqual(['Out of leads: under a day of supply left'])
    expect(seatWarnings(d, 'ivan')).toEqual([])
  })

  it('three squares, the chosen one pressed; clicking another chooses it; unknown numbers are "?" never 0', () => {
    const pick = vi.fn()
    renderInFrame(<SeatSquares seats={['ivan', 'risedtc', 'arch']} seat="ivan" pick={pick} d={data()} now={Date.now()} />)
    const tabs = [...document.querySelectorAll('[data-pick]')]
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(document.querySelector('[data-seat="arch"] .dl-sqr')!.textContent).toBe('?invites today?DMs today?InMail today')
    fireEvent.click(document.querySelector('[data-pick="arch"]')!)
    expect(pick).toHaveBeenCalledWith('arch')
  })
})
