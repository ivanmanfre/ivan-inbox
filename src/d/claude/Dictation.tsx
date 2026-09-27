import { useEffect, useRef, useState } from 'react'
import type { SttClip } from '../../exp/v2c/chat/useStt'
import { CIcon } from './icons'

// Today's dictation strip (wb/ask/Composer.tsx + VoiceNote.tsx), drawn in D:
// while recording, a moving meter, the seconds and a Done key; after, the
// "Heard" card with what was written down, the recording itself to play back
// (the very blob that was posted to inbox-stt, with its measured peaks), and a
// dismiss. Nothing here sends: the words land in the field.

export function Meter({ ms }: { ms: number }) {
  const bars = 14
  return (
    <span className="dcl-meter" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const h = 4 + Math.round(10 * Math.abs(Math.sin(ms / 180 + i * 0.9)))
        return <i key={i} style={{ height: `${h}px` }} />
      })}
    </span>
  )
}

function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function VoiceNote({ clip }: { clip: SttClip }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  useEffect(() => { setPlaying(false); setAt(0) }, [clip.url])
  const peaks = clip.peaks ?? Array.from({ length: 28 }, () => 0.12)
  const played = clip.ms > 0 ? at / (clip.ms / 1000) : 0
  return (
    <span className="dcl-vnote">
      <button type="button" className="dcl-ib" aria-label={playing ? 'Pause what you said' : 'Play what you said'}
        onClick={() => { const el = audio.current; if (!el) return; if (playing) el.pause(); else void el.play() }}>
        <CIcon name={playing ? 'pause' : 'play'} />
      </button>
      <span className="dcl-wave" aria-hidden="true">
        {peaks.map((p, i) => <i key={i} className={i / peaks.length <= played ? 'dcl-done' : ''} style={{ height: `${Math.round(3 + p * 17)}px` }} />)}
      </span>
      <small>{dur(clip.ms)}</small>
      <audio ref={audio} src={clip.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setAt(0) }} onTimeUpdate={e => setAt(e.currentTarget.currentTime)} />
    </span>
  )
}

export function Heard({ text, clip, onDismiss }: { text: string | null; clip: SttClip | null; onDismiss: () => void }) {
  if (!text && !clip) return null
  return (
    <div className="dcl-heard" data-heard>
      <div className="dcl-heard-t"><b>Heard</b>{text && <span>{text}</span>}</div>
      {clip && <VoiceNote clip={clip} />}
      <button type="button" className="dcl-link" onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
