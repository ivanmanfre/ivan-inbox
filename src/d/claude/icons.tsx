// The Claude drawer's own glyphs, copied from the D mocks (dms-full-frame.js,
// pshell.js), drawn like DIcon: 24x24, stroke from the text colour.
const G = {
  chats: <path d="M4 6h16M4 12h16M4 18h10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  clip: <path d="M16 8l-6.5 6.5a2 2 0 0 0 3 3L19 11a4 4 0 0 0-6-6l-7 7a6 6 0 0 0 8.5 8.5L20 15" />,
  mic: <path d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM6 11a6 6 0 0 0 12 0M12 17v3" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></>,
  run: <path d="M5 5h14v10H5zM9 19h6M12 15v4" />,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  voice: <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />,
  play: <path d="M8 5l11 7-11 7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
} as const

export type CIconName = keyof typeof G

export function CIcon({ name }: { name: CIconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="dcl-ico">
      {G[name]}
    </svg>
  )
}
