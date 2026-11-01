// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderInFrame } from '../test-utils'

afterEach(() => { cleanup(); document.body.innerHTML = ''; summary.failed = false })

const summary = { value: null as unknown, failed: false }
vi.mock('../../hooks/useSeatHealth', () => ({ useSeatHealthState: () => ({ summary: summary.value, failed: summary.failed }) }))
const { SeatHealthBanner } = await import('./SeatHealth')

describe('SeatHealthBanner', () => {
  it('draws nothing while every seat is up', () => {
    summary.value = { updated_at: new Date().toISOString(), seats: [{ id: 'a', name: 'Arch', account: 'OK', sn: 'OK', degraded: false, link: null }] }
    renderInFrame(<SeatHealthBanner />)
    expect(document.querySelector('[data-seat-health]')).toBeNull()
  })
  it('Reconnect opens the seat reconnect link in a new tab and writes nothing', () => {
    summary.value = { updated_at: new Date().toISOString(), seats: [{ id: 'a', name: 'Arch', account: 'CREDENTIALS', sn: null, degraded: true, link: 'https://reconnect.example/arch' }] }
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderInFrame(<SeatHealthBanner />)
    expect(screen.getByText('Arch: LinkedIn seat disconnected')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-verb="reconnect"]')!)
    expect(open).toHaveBeenCalledWith('https://reconnect.example/arch', '_blank', 'noopener,noreferrer')
  })
  it('a failed refresh keeps the Reconnect line and says the read failed', () => {
    summary.value = { updated_at: new Date().toISOString(), seats: [{ id: 'a', name: 'Arch', account: 'CREDENTIALS', sn: null, degraded: true, link: 'https://reconnect.example/arch' }] }
    summary.failed = true
    renderInFrame(<SeatHealthBanner />)
    expect(screen.getByText('Arch: LinkedIn seat disconnected')).toBeTruthy()
    expect(screen.getByText('Seat health could not be refreshed. This is the last good check.')).toBeTruthy()
  })
  it('a failed first read says so instead of drawing nothing', () => {
    summary.value = null
    summary.failed = true
    renderInFrame(<SeatHealthBanner />)
    expect(screen.getByText('Seat health could not be read.')).toBeTruthy()
  })
})
