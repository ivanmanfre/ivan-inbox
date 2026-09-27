// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderInFrame } from '../test-utils'
import { AnswerRow, N } from './AnswerRow'
import { NotBuilt } from './NotBuilt'
import { SeatCounts, SeatTrio } from './SeatCounts'
import { Key } from './Key'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('SeatCounts / SeatTrio', () => {
  it('one number per seat, never a total; unread, unknown and failed say so', () => {
    renderInFrame(<SeatCounts label="Drafts for you" numbers={{ ivan: 2, risedtc: null, arch: null }} failed={{ arch: true }} />)
    const line = document.querySelector('.d-per')!
    expect(line.textContent).toBe('Drafts for youIvan 2Rise …Arch ?')
    expect(line.getAttribute('aria-label')).toBe('Drafts for you: Ivan 2, Rise reading, Arch could not read')
  })
  it('the dock trio lights live numbers only', () => {
    renderInFrame(<SeatTrio numbers={{ ivan: 7, risedtc: 0, arch: 22 }} />)
    expect(document.querySelector('.d-trio')!.textContent).toBe('7·0·22')
    expect([...document.querySelectorAll('.d-trio i.d-hot')].map(x => x.textContent)).toEqual(['7', '22'])
  })
})

describe('AnswerRow', () => {
  it('renders inline on the phone', () => {
    renderInFrame(<AnswerRow title={<>Needs you: <N v={2} /> yours, <N v={0} /> Rise.</>} sub="Rise opens 14:00." />, { layout: 'phone' })
    expect(document.querySelector('.d-pans h1')!.textContent).toBe('Needs you: 2 yours, 0 Rise.')
    expect(document.querySelector('.d-n-zero')!.textContent).toBe('0')
  })
  it('is placed into the frame row on the desktop', async () => {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    renderInFrame(<AnswerRow title="Lanes" sub="x" />, { frame: { titleSlot: slot } })
    await waitFor(() => expect(slot.querySelector('h1')!.textContent).toBe('Lanes'))
  })
  it('an unknown number is "?", never a guess', () => {
    renderInFrame(<AnswerRow title={<N v={null} />} />, { layout: 'phone' })
    expect(document.querySelector('.d-n-unk')!.textContent).toBe('?')
  })
})

describe('Key', () => {
  it('carries data-verb for the write proofs', () => {
    renderInFrame(<Key primary verb="approve" sub="a">Approve</Key>)
    const k = document.querySelector('[data-verb="approve"]')!
    expect(k.className).toContain('d-key-p')
    expect(k.textContent).toBe('Approvea')
  })
})

describe('NotBuilt', () => {
  it('says so honestly and links today\'s page', () => {
    renderInFrame(<NotBuilt place="ops" layout="phone" />, { layout: 'phone' })
    expect(screen.getByText('Not built yet in this preview. Open today\'s page:')).toBeTruthy()
    expect(screen.getByText("Today's Ops").getAttribute('href')).toBe('#exp/brain-b/ops')
  })
})