// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BookingSong, BOOKING_SONG_EMBED, BOOKING_SONG_URL } from './BookingSong'
import { formatBookingForSlack } from './slackFormat.js'

describe('BookingSong', () => {
  afterEach(cleanup)
  it('loads no player until tapped, then loads it paused (never autoplay)', () => {
    const { container } = render(<BookingSong />)
    expect(container.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /play the song/i }))
    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('src')).toBe(BOOKING_SONG_EMBED)
    expect(frame!.getAttribute('src')).toContain('youtube-nocookie.com/embed/SwYN7mTi6HM')
    expect(frame!.getAttribute('src')).not.toMatch(/autoplay/i)
    fireEvent.click(screen.getByRole('button', { name: /hide the song/i }))
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('links the plain video url, without playlist params', () => {
    render(<BookingSong />)
    expect(BOOKING_SONG_URL).toBe('https://www.youtube.com/watch?v=SwYN7mTi6HM')
    expect(screen.getByRole('link', { name: 'YouTube' }).getAttribute('href')).toBe(BOOKING_SONG_URL)
  })

  it('never reaches the text a client channel receives', () => {
    const out = formatBookingForSlack('New call booked: Jane Doe from outbound.\nPre-call brief: https://example.com/brief', {})
    expect(out).not.toMatch(/youtube|SwYN7mTi6HM|song/i)
  })
})
