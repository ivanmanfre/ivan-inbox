// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhoneWall } from './PhoneWall'
import type { ContentData, SeatRead } from './useContentData'
import type { Lane } from './model'

// B4-DEV finding 3: a seat still reading printed "next none · published 0".
// Loading shows "…", never a zero; a loaded seat shows its real numbers.

afterEach(() => { cleanup() })

const reading: SeatRead = { rows: [], loading: true, error: null, loadedAt: null, refresh: vi.fn() }
const loaded: SeatRead = { rows: [], loading: false, error: null, loadedAt: '2026-09-27T10:00:00Z', refresh: vi.fn() }
const data = (s: Record<Lane, SeatRead>) => ({ seats: s, armed: null, armedFailed: false, verdict: null, blocks: null, queueRows: null, refreshAll: vi.fn(), failed: 0 }) as unknown as ContentData
const items = { ivan: new Map(), risedtc: new Map(), arch: new Map() }

describe('PhoneWall seat lines', () => {
  it('a seat still reading shows "…" for next and published, never none / 0', () => {
    const { container } = render(<PhoneWall data={data({ ivan: reading, risedtc: loaded, arch: reading })} items={items} days={[]} stuck={null} onOpen={vi.fn()} onMove={vi.fn()} onArm={vi.fn()} />)
    const lines = [...container.querySelectorAll('.cn-bh small')].map(x => x.textContent)
    expect(lines.filter(t => t === 'in 2 weeks · next … · published …')).toHaveLength(2)
    expect(lines.filter(t => t === 'in 2 weeks · next none · published 0')).toHaveLength(1)
  })
})
