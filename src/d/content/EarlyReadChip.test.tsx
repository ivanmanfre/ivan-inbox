// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { parsePatternRead } from '../../lib/earlyReads'
import { EarlyReadChip } from './EarlyReadChip'
afterEach(cleanup)
const read = parsePatternRead({ state: 'ready', pattern: { client_id: 'ivan', dimension: 'angle', value: 'personal', n: 100, breakouts: 12, rate: .12, base_n: 1000, base_rate: .045, lift: 2.6667 }, sentence: 'Stored niche sentence. This is an early read.', recipe_fit: { score: 3.2, validated: true } })
it('opens stored evidence without opening the card and returns focus after close', () => {
 const open = vi.fn()
 renderInFrame(<div onClick={open}><EarlyReadChip read={read} lane="ivan" /></div>)
 const button = screen.getByRole('button', { name: /12%.*early read.*n=100/i })
 button.focus(); fireEvent.click(button)
 expect(screen.getByRole('dialog', { name: 'Early read' })).toBeTruthy()
 expect(screen.getByText('Stored niche sentence. This is an early read.')).toBeTruthy()
 expect(screen.getByText(/Recipe fit: 3.20/)).toBeTruthy()
 expect(open).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: 'Close' }))
 expect(document.activeElement).toBe(button)
 expect(open).not.toHaveBeenCalled()
})
it('removes a saved chance during unsaved editing and exposes its reason', () => {
 renderInFrame(<EarlyReadChip read={read} lane="ivan" unsaved />)
 expect(screen.queryByText(/12%/)).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: /unsaved/i }))
 expect(screen.getByText(/Save the changed body/)).toBeTruthy()
})
it('distinguishes failed, absent and ARCH small-sample states', () => {
 const r = renderInFrame(<EarlyReadChip read={{ ...read, state: 'failed', reason: 'Read refused', pattern: null }} lane="arch" />)
 expect(screen.getByRole('button', { name: /unavailable/i })).toBeTruthy()
 r.rerender(<EarlyReadChip read={undefined} lane="arch" />)
 expect(screen.getByRole('button', { name: /No read yet/i })).toBeTruthy()
 r.rerender(<EarlyReadChip read={{ ...read, pattern: { ...read.pattern!, client_id: "arch" } }} lane="arch" />)
 expect(screen.getByRole('button', { name: /small sample/i })).toBeTruthy()
})
it('does not reveal a percentage from a stale cached subthreshold cell', () => {
 renderInFrame(<EarlyReadChip read={{ ...read, pattern: { ...read.pattern!, n: 24 } }} lane="ivan" />)
 expect(screen.queryByText(/12%/)).toBeNull()
})
