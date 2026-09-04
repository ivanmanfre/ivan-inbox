// The drawn marks. Every icon in skin a is one stroke weight of currentColor
// at the one glyph size, so six tab slots share one optical weight instead of
// the six different metrics the unicode glyphs (✳ ☼ ◉ ▤ ⇅ ◈) carry.
export type GlyphName =
  | 'ask' | 'today' | 'dms' | 'content' | 'sends' | 'ops'
  | 'feed' | 'back' | 'x' | 'plus' | 'mic' | 'send' | 'stop' | 'doc' | 'play'

const PATHS: Record<GlyphName, string> = {
  ask: 'M10 3.2v13.6M4 6.6l12 6.8M16 6.6L4 13.4',
  today: 'M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M15.4 4.6l-1.3 1.3M5.9 14.1l-1.3 1.3',
  dms: 'M3.4 6.2A2.2 2.2 0 0 1 5.6 4h8.8a2.2 2.2 0 0 1 2.2 2.2v5.4a2.2 2.2 0 0 1-2.2 2.2H8.2L4.6 16.6v-2.8h-1a.2.2 0 0 1-.2-.2z',
  content: 'M3.6 5.2h12.8M3.6 10h12.8M3.6 14.8h8',
  sends: 'M6.4 16V4.6M3.4 7.6l3-3 3 3M13.6 4v11.4M10.6 12.4l3 3 3-3',
  ops: 'M4.2 15.2a7 7 0 1 1 11.6 0M10 11.6l3.2-3.4',
  feed: 'M4 5.6h12M4 10h12M4 14.4h8',
  back: 'M12.4 4.6L6.8 10l5.6 5.4',
  x: 'M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2',
  plus: 'M10 4.4v11.2M4.4 10h11.2',
  mic: 'M4.6 9.6a5.4 5.4 0 0 0 10.8 0M10 15v2.4',
  send: 'M10 16V4.6M5.2 9.4L10 4.6l4.8 4.8',
  stop: '',
  doc: 'M6 3.6h5.4L15 7.2v9.2H6zM11.2 3.8v3.6H15',
  play: '',
}

export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      className="bb-a-glyph" width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'stop' && <rect x="5.6" y="5.6" width="8.8" height="8.8" rx="1.6" fill="currentColor" stroke="none" />}
      {name === 'play' && <path d="M7.6 5.4l7.4 4.6-7.4 4.6z" fill="currentColor" stroke="none" />}
      {name === 'mic' && <rect x="7.4" y="2.8" width="5.2" height="9" rx="2.6" />}
      {name === 'ops' && <circle cx="10" cy="15.2" r="0.9" fill="currentColor" stroke="none" />}
      {name === 'today' && <circle cx="10" cy="10" r="3.6" />}
      {name === 'feed' && <circle cx="15.4" cy="14.4" r="1.4" fill="currentColor" stroke="none" />}
      {PATHS[name] && <path d={PATHS[name]} />}
    </svg>
  )
}
