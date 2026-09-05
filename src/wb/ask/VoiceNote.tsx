/* ==========================================================================
   src/wb/ask/VoiceNote.tsx: S30, 03-DIRECTION move 15's third beat.

   A compact bubble for a recording: one round play control, a waveform, and
   the duration in mono. Every part of it is measured rather than drawn:

   - the bars are the peaks `useStt.decodePeaks` pulled out of THAT audio,
   - the duration is the length of the recording the recorder actually made,
   - play really plays it, and the bars fill as the head travels.

   Where it is NOT a sent voice note, and why. This app has one dictation path
   and it inserts a transcript into the composer; nothing in the transport
   sends audio anywhere (`useStt`'s own header: "Dictation drafts; the operator
   sends"). So the bubble sits in the tray beside what was heard, which is the
   true statement, rather than in the thread as a note that went out.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../ds'
import type { SttClip } from '../../exp/v2c/chat/useStt'
import './ask.css'

/** m:ss, from the measured length. */
function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function VoiceNote({ clip }: { clip: SttClip }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)

  // A new clip replaces the old one under the same element, so the head and
  // the state go back to the start with it.
  useEffect(() => { setPlaying(false); setAt(0) }, [clip.url])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (playing) { el.pause(); return }
    void el.play()
  }

  // Until the decode lands there is nothing measured to draw, so the bars sit
  // flat rather than taking a shape the audio has not been asked about.
  const peaks = clip.peaks ?? Array.from({ length: 28 }, () => 0.12)
  const played = clip.ms > 0 ? at / (clip.ms / 1000) : 0

  return (
    <div className="a-brain-vnote" data-voice-note data-playing={playing ? '' : undefined}>
      <IconButton
        icon={playing ? 'pause' : 'play'} variant="accent" round size="sm"
        label={playing ? 'Pause what you said' : 'Play what you said'}
        onClick={toggle}
      />
      <span className="a-brain-wave" aria-hidden="true">
        {peaks.map((p, i) => (
          <span
            key={i}
            className="a-brain-wave-b"
            data-done={i / peaks.length <= played ? '' : undefined}
            style={{ height: `${Math.round(3 + p * 21)}px` }}
          />
        ))}
      </span>
      <span className="a-brain-vnote-d a-mono">{duration(clip.ms)}</span>
      <audio
        ref={audio} src={clip.url} preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setAt(0) }}
        onTimeUpdate={e => setAt(e.currentTarget.currentTime)}
      />
    </div>
  )
}
