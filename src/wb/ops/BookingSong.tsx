/* ==========================================================================
   The song on a booked-meeting card (Ivan, 2026-10-19: "when meeting booking
   card in ops etc can we embed this music lol").

   Ivan's own surface only: this lives in the inbox app, never in the stored
   card body and never in the text a client channel receives. The Slack sender
   posts `body` byte for byte (formatted), so nothing here can reach a client.

   Never autoplay. The YouTube player is not loaded until he taps "Play the
   song", and even then it loads paused (no autoplay param); the second tap
   is YouTube's own play button. youtube-nocookie keeps the page cookie-free
   until that tap.
   ========================================================================== */
import { useState } from 'react'
import { Button } from '../../ds'
import './ops.css'

export const BOOKING_SONG_ID = 'SwYN7mTi6HM'
export const BOOKING_SONG_URL = `https://www.youtube.com/watch?v=${BOOKING_SONG_ID}`
export const BOOKING_SONG_EMBED = `https://www.youtube-nocookie.com/embed/${BOOKING_SONG_ID}?rel=0&playsinline=1`

export function BookingSong() {
  const [open, setOpen] = useState(false)
  return (
    <div className="a-booking-song" data-open={open ? '' : undefined} onClick={e => e.stopPropagation()}>
      <div className="a-booking-song-bar">
        <Button
          variant="quiet" size="sm" icon={open ? 'close' : 'play'}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >{open ? 'Hide the song' : 'Play the song'}</Button>
        <a className="a-meta" href={BOOKING_SONG_URL} target="_blank" rel="noopener noreferrer">YouTube</a>
      </div>
      {open && (
        <div className="a-booking-song-frame">
          <iframe
            title="Booked-meeting song"
            src={BOOKING_SONG_EMBED}
            loading="lazy"
            allow="encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      )}
    </div>
  )
}
