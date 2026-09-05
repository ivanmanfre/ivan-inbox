/* ==========================================================================
   src/ds/icons.tsx — the icon set.

   lucide-react at three sizes (16 / 20 / 24) and one stroke (1.75). Every
   unicode glyph the app draws today has a name here; a screen never types a
   glyph again. `Icon` is the only way a primitive draws one, so the size and
   stroke cannot drift, and an icon-only control cannot ship without a label
   (IconButton requires one).
   ========================================================================== */
import {
  Activity, ArrowDown, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpDown,
  ArrowUpRight, Banknote, Bell, BadgeCheck, Calendar, CalendarClock,
  ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  ChevronsLeft, ChevronsRight, Circle, CircleAlert, CircleCheck,
  ClipboardCheck, Clock, Command, Copy, CornerDownLeft, Delete, Diamond, Dot,
  ExternalLink, Eye, FileText, Filter, Flame, GripVertical, Hash, Image,
  Inbox, Keyboard, Layers, LayoutList, Link, List, ListChecks, Loader, Lock,
  LogOut, Magnet, Mail, Maximize2, MessagesSquare, Mic, Minus, MoreHorizontal,
  OctagonX, Palette, PanelLeft, PanelRight, Paperclip, Pause, Pencil, Phone,
  Play, Plus, Quote, RefreshCw, Reply, RotateCw, Search, Send, Settings,
  ShieldAlert, SlidersHorizontal, Smile, Sparkles, Square, SquareCheck, Star,
  Sun, Target, ThumbsUp, Timer, Trash2, TrendingDown, TrendingUp, TriangleAlert,
  Undo2, Upload, User, Users, Video, Volume2, Wand, X, Zap,
} from 'lucide-react'
import type { SVGProps } from 'react'

/* --- the map. Left column is the glyph the app used to type. -------------- */
export const ICONS = {
  /* the ten job icons (src/exp/v2c/layout.ts JOB_ICON, src/exp/brain/b/place.ts) */
  today: Sun,               /* was the sun glyph */
  dms: MessagesSquare,      /* was the fisheye glyph */
  content: LayoutList,      /* was the squared-fill glyph */
  magnets: Magnet,          /* was the square-lattice glyph */
  styles: Palette,          /* was the diagonal-lattice glyph */
  strategy: Target,         /* was the bullseye glyph */
  sends: ArrowUpDown,       /* was the up-down arrow glyph */
  money: Banknote,          /* was the white-square-containing glyph */
  ops: ClipboardCheck,      /* was the lozenge glyph */
  settings: Settings,       /* was the gear glyph */
  ask: Sparkles,            /* was the eight-spoked asterisk (Claude's mark) */

  /* chrome and navigation */
  close: X,
  back: ChevronLeft,
  forward: ChevronRight,
  collapse: ChevronsLeft,
  expand: ChevronsRight,
  disclose: ChevronDown,
  discloseUp: ChevronUp,
  paneLeft: PanelLeft,
  paneRight: PanelRight,
  full: Maximize2,
  more: MoreHorizontal,
  drag: GripVertical,
  home: Sun,

  /* action */
  check: Check,
  checked: SquareCheck,
  approve: CircleCheck,
  discard: Trash2,
  remove: X,
  add: Plus,
  minus: Minus,
  edit: Pencil,
  copy: Copy,
  refresh: RotateCw,
  retry: RefreshCw,
  undo: Undo2,
  send: Send,
  stop: Square,
  play: Play,
  pause: Pause,
  reply: Reply,
  upload: Upload,
  attach: Paperclip,
  search: Search,
  filter: Filter,
  sliders: SlidersHorizontal,
  external: ExternalLink,
  link: Link,
  open: ArrowUpRight,
  next: ArrowRight,
  swap: ArrowLeftRight,
  signOut: LogOut,
  like: ThumbsUp,

  /* state and severity */
  alert: TriangleAlert,
  blocked: OctagonX,
  error: CircleAlert,
  clear: BadgeCheck,
  guard: ShieldAlert,
  live: Circle,
  dot: Dot,
  loading: Loader,
  up: ArrowUp,
  down: ArrowDown,
  deltaUp: TrendingUp,
  deltaDown: TrendingDown,
  running: Activity,

  /* objects */
  time: Clock,
  timer: Timer,
  calendar: Calendar,
  scheduled: CalendarClock,
  doc: FileText,
  quote: Quote,
  image: Image,
  list: List,
  layers: Layers,
  chart: ChartColumn,
  tasks: ListChecks,
  inbox: Inbox,
  mail: Mail,
  call: Phone,
  video: Video,
  mic: Mic,
  volume: Volume2,
  person: User,
  people: Users,
  tag: Hash,
  star: Star,
  eye: Eye,
  lock: Lock,
  bell: Bell,
  flame: Flame,
  zap: Zap,
  smile: Smile,
  diamond: Diamond,
  wand: Wand,

  /* keys */
  cmd: Command,
  enter: CornerDownLeft,
  del: Delete,
  keyboard: Keyboard,
} as const

export type IconName = keyof typeof ICONS
export type IconSize = 16 | 20 | 24

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'ref'> {
  name: IconName
  /** 16 dense meta · 20 the default control glyph · 24 an empty state */
  size?: IconSize
  /** Set only on a decorative icon that sits beside its own visible label. */
  label?: string
}

export function Icon({ name, size = 20, label, className, ...rest }: IconProps) {
  const Glyph = ICONS[name]
  return (
    <Glyph
      data-ds="Icon"
      data-icon={name}
      width={size}
      height={size}
      strokeWidth={1.75}
      className={className ? `ds-icon ${className}` : 'ds-icon'}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  )
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[]
