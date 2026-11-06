// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { parseResults } from '../../lib/earlyReads'
import { WhatWorksNowBody } from './WhatWorksNow'
afterEach(cleanup)
const p = { client_id: 'arch', dimension: 'angle', value: 'personal', n: 100, breakouts: 12, rate: .12, base_n: 1000, base_rate: .045, lift: 2.6667 }
const result = parseResults({ ok: true, client: 'arch', computed_at: '2026-10-01', patterns: [p], top_patterns: [p], bottom_patterns: [{ ...p, value: 'how_to', rate: 0, breakouts: 0 }], holdout: { state: 'not_confirmed', reason: 'Stored recent-post caveat.', top: { n: 20, rate: .1 }, bottom: { n: 20, rate: .2 } } }, 'arch')
it('shows niche rates in plain words: post counts, the usual rate, a loose-read note and the newer-post check', () => {
 const { container } = renderInFrame(<WhatWorksNowBody lane="arch" data={result} error={null} onRetry={() => {}} />)
 expect(screen.getByRole('heading', { name: 'What works now' })).toBeTruthy()
 expect(screen.getByText(/read it loosely/)).toBeTruthy()
 expect(screen.getByText(/Not proven on newer posts yet\. The best third took off 10% of the time, the weakest third 20%/)).toBeTruthy()
 expect(screen.getAllByText('from 100 posts')).toHaveLength(2)
 expect(screen.getByText('Personal posts')).toBeTruthy()
 expect(screen.getByText('How-to posts')).toBeTruthy()
 expect(screen.getByText('0%')).toBeTruthy()
 // none of the statistics words he asked to lose
 expect(container.textContent).not.toMatch(/n=|interval|holdout|breakout/i)
})
it('an RPC failure exposes Retry and does not pretend that there are no patterns', () => {
 let retries = 0
 renderInFrame(<WhatWorksNowBody lane="ivan" data={null} error="Read refused" onRetry={() => { retries++ }} />)
 expect(screen.getByText('Read refused')).toBeTruthy()
 fireEvent.click(screen.getByRole('button', { name: /Retry/i })); expect(retries).toBe(1)
 expect(screen.queryByText(/No patterns/)).toBeNull()
})
