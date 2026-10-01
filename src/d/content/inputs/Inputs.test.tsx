// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import { fetchInputs, type InputsPayload } from '../../../lib/cb22'
import { putOutlierOnBoard } from '../../../lib/outliers'
import { readSwr, writeSwr } from '../../../lib/swr'
import { Inputs, InputsPage } from './Inputs'

vi.mock('../../../lib/cb22', async original => ({ ...await original<typeof import('../../../lib/cb22')>(), fetchInputs: vi.fn(), fetchInputsCounts: vi.fn().mockResolvedValue(null) }))
vi.mock('../../../lib/outliers', async original => ({ ...await original<typeof import('../../../lib/outliers')>(), putOutlierOnBoard: vi.fn().mockResolvedValue({ ok: true, id: 'saved', created: true }) }))
vi.mock('../../../lib/brainAccount', async original => ({ ...await original<typeof import('../../../lib/brainAccount')>(), fetchOutlierLabels: vi.fn().mockResolvedValue({ client: 'arch', rows: [], calibration: { state: 'waiting_for_labels', labelN: 0, requiredN: 30, runnerReady: false, reason: 'Fixture waiting' } }) }))
const payload = (patch: Partial<InputsPayload> = {}): InputsPayload => ({ client: 'arch', week_start: '2026-09-28', top: [], buyers: [], counts: { window: 67, recommended: 0, in_review: 0, judged: 57, outliers: 73, buyers: 0 }, last_run: null, rule: '', ...patch })
beforeEach(() => { vi.mocked(fetchInputs).mockReset(); vi.mocked(fetchInputs).mockResolvedValue({ kind: 'ready', data: payload() }) })
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

describe('Outliers reads and choices', () => {
  it('keeps cached sources with their saved timestamp and exposes failed refresh recovery', async () => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'inputs-user' } }))
    const data=payload({ buyers: [{ name: 'Stored buyer', headline: 'Buyer company', icp: 8, why: 'Buys this service', url: 'https://linkedin.test/buyer', posts: 2, commented: true, last_seen: '2026-09-29T12:00:00Z', post_title: 'Stored post' }] })
    writeSwr('cb22-inputs:arch', data)
    const savedAt=readSwr('cb22-inputs:arch')?.savedAt
    vi.mocked(fetchInputs).mockResolvedValueOnce({ kind: 'failed', message: 'Connection lost' }).mockResolvedValue({ kind: 'ready', data: payload() })
    renderInFrame(<InputsPage lane="arch" setLane={()=>{}} phone query={new URLSearchParams()}/> )
    await waitFor(()=>expect(screen.getByText(/Refresh failed: Connection lost/)).toBeTruthy())
    expect(screen.getByText(/Showing saved data from/)).toBeTruthy()
    expect(document.querySelector('.in-refresh-notice time')?.getAttribute('datetime')).toBe(savedAt)
    expect(screen.getByText('Stored buyer')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Retry'}))
    await waitFor(()=>expect(screen.queryByText(/Refresh failed:/)).toBeNull())
    expect(screen.queryByText('Stored buyer')).toBeNull()
  })
  it('discloses buyer provenance on a phone and describes an empty eligible list truthfully', () => {
    const data=payload({ buyers: [{ name: 'A buyer', headline: 'VP at Buyer Co', icp: 8, why: 'Owns the budget', url: 'https://linkedin.test/buyer', posts: 2, commented: true, last_seen: '2026-09-29T12:00:00Z', post_title: 'A source post' }] })
    renderInFrame(<Inputs lane="arch" setLane={()=>{}} layout="list" reads={{ivan:null,risedtc:null,arch:{kind:'ready',data}}} refresh={()=>{}} phone/> )
    expect(screen.getByText('VP at Buyer Co')).toBeTruthy()
    expect(screen.getByText(/last recorded/)).toBeTruthy()
    expect(screen.getByText(/Owns the budget/)).toBeTruthy()
    expect(screen.getByText(/A source post/)).toBeTruthy()
    expect(screen.getByText(/No sources currently pass/)).toBeTruthy()
    expect(screen.queryByText(/No outlier in the last 21 days/)).toBeNull()
    expect(screen.getByText(/Reactions and comments may be older/)).toBeTruthy()
  })
  it('saves a source to the correct client and names the destination as Ideas', async () => {
    const source={rank:1,platform:'x' as const,post_id:'123',author:'Author',url:'https://x.test/123',text:'Source post',published_at:null,lift:4,likes:40,reason:'Fits this client',state:null,idea:null} as InputsPayload['top'][number]
    renderInFrame(<Inputs lane="arch" setLane={()=>{}} layout="list" reads={{ivan:null,risedtc:null,arch:{kind:'ready',data:payload({top:[source]})}}} refresh={()=>{}} phone/> )
    fireEvent.click(screen.getByRole('button',{name:'Save idea'}))
    await waitFor(()=>expect(screen.getByRole('link',{name:'Open in Ideas'})).toBeTruthy())
    expect(putOutlierOnBoard).toHaveBeenCalledWith('arch','x','123')
    expect(screen.getByRole('link',{name:'Open in Ideas'}).getAttribute('href')).toBe('#exp/d/content/ideas?lane=arch')
    expect(screen.getByText('Nothing is scheduled or sent.')).toBeTruthy()
  })
})
