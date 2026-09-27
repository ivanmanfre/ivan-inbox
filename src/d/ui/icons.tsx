// The D mocks' own line glyphs (shell.js / pshell.js / dms-full-frame.js),
// drawn at 24x24 with the stroke inherited from the text colour.
const P = {
  home: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-6h4v6" />,
  lanes: <path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />,
  dms: <path d="M4 5h16v11H9l-5 4z" />,
  content: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
  ops: <path d="M9 4h6v3H9zM6 6h12v14H6zM9 12l2 2 4-4" />,
  sales: <path d="M4 13l4-4 4 3 4-5 4 3M4 19h16" />,
  claude: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />,
  workflows: <path d="M4 5h6v5H4zM14 14h6v5h-6zM7 10v6.5h7M17 14V7.5h-7" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17v.5" />,
  check: <path d="M5 12l5 5 9-10" />,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  time: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  sum: <path d="M5 6h14M5 10h14M5 14h9M5 18h6" />,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  external: <path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" />,
  undo: <path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3" />,
  retry: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
  back: <path d="M15 5l-7 7 7 7" />,
  foldIn: <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />,
  foldOut: <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />,
  chevDown: <path d="M6 9l6 6 6-6" />,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  plug: <path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4" />,
  offline: <path d="M4 4l16 16M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M19 12.5a10 10 0 0 0-3.2-2.1M12 20h.01" />,
} as const

export type DIconName = keyof typeof P

export function DIcon({ name, className }: { name: DIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className ?? 'd-ico'}>
      {P[name]}
    </svg>
  )
}
