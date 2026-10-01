// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { parseResults } from '../../lib/earlyReads'
import { WhatWorksNowBody } from './WhatWorksNow'
afterEach(cleanup)
const p = { client_id: 'arch', dimension: 'angle', value: 'personal', n: 100, breakouts: 12, rate: .12, base_n: 1000, base_rate: .045, lift: 2.6667 }
const result = parseResults({ ok: true, client: 'arch', computed_at: '2026-10-01', patterns: [p], top_patterns: [p], bottom_patterns: [{ ...p, value: 'how_to', rate: 0, breakouts: 0 }], holdout: { state: 'not_confirmed', reason: 'Stored recent-post caveat.', top: { n: 20, rate: .1 }, bottom: { n: 20, rate: .2 } } }, 'arch')
it('shows niche rates, all denominators, small sample and the stored holdout outcome', () => {
 renderInFrame(<WhatWorksNowBody lane="arch" data={result} error={null} onRetry={() => {}} />)
 expect(screen.getByRole('heading', { name: 'What works now' })).toBeTruthy()
 expect(screen.getByText(/small sample/)).toBeTruthy()
 expect(screen.getByText(/not yet confirmed on recent posts/i)).toBeTruthy()
 expect(screen.getAllByText(/n=100/)).toHaveLength(2)
 expect(screen.getByText('0%')).toBeTruthy()
 expect(screen.getByText(/top n=20.*bottom n=20/i)).toBeTruthy()
})
it('an RPC failure exposes Retry and does not pretend that there are no patterns', () => {
 let retries = 0
 renderInFrame(<WhatWorksNowBody lane="ivan" data={null} error="Read refused" onRetry={() => { retries++ }} />)
 expect(screen.getByText('Read refused')).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: /Retry/i })); expect(retries).toBe(1)
 expect(screen.queryByText(/No patterns/)).toBeNull()
})
