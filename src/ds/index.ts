/* ==========================================================================
   src/ds — the design system. One import site for every primitive.

   Load order matters once: `import './ds.css'` (which @imports tokens.css)
   must run before any primitive renders, and the app root element must carry
   the `ds-body` class so the base and the reduced-motion collapse apply.
   ========================================================================== */
import './ds.css'

export { cx } from './util'
export type { Tone, Density } from './util'

export { Icon, ICONS, ICON_NAMES } from './icons'
export type { IconName, IconProps, IconSize } from './icons'

export {
  spring, springSoft, ease, fadeT, fade, rise, pop, sheet, list, presence,
  stagger, DUR, DUR_HOVER, DUR_SLOW, STAGGER,
} from './motion'
export { Motion } from './MotionProvider'

export { Shell, ShellBody, Peer } from './Shell'
export type { ShellProps } from './Shell'
export { Rail, RailItem, RailGroup, RailSeparator } from './Rail'
export type { RailProps, RailItemProps } from './Rail'
export { TabBar } from './TabBar'
export type { TabBarProps, TabItem } from './TabBar'
export { Header } from './Header'
export type { HeaderProps } from './Header'

export { List, ListRow } from './ListRow'
export type { ListProps, ListRowProps } from './ListRow'
export { Divider, DayHeader } from './Divider'
export type { DayHeaderProps } from './Divider'
export { Card } from './Card'
export type { CardProps } from './Card'
export { SectionCard, SettingRow } from './SectionCard'
export type { SectionCardProps, SettingRowProps } from './SectionCard'
export { Table } from './Table'
export type { TableProps, TableColumn } from './Table'

export { Chip } from './Chip'
export type { ChipProps } from './Chip'
export { Badge } from './Badge'
export type { BadgeProps, BadgeTone } from './Badge'
export { Kbd } from './Kbd'
export { Avatar } from './Avatar'
export type { AvatarProps } from './Avatar'

export { Button } from './Button'
export type { ButtonProps, ButtonVariant } from './Button'
export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'
export { Switch } from './Switch'
export type { SwitchProps } from './Switch'
export { Segmented } from './Segmented'
export type { SegmentedProps, SegmentedOption } from './Segmented'
export { Tabs } from './Tabs'
export type { TabsProps, TabsOption } from './Tabs'
export { Input } from './Input'
export type { InputProps } from './Input'
export { Textarea } from './Textarea'
export type { TextareaProps } from './Textarea'
export { Composer, LevelMeter } from './Composer'
export type { ComposerProps, ComposerMode } from './Composer'

export { Sheet } from './Sheet'
export type { SheetProps } from './Sheet'
export { Dialog } from './Dialog'
export type { DialogProps } from './Dialog'
export { Popover, PopoverItem } from './Popover'
export type { PopoverProps } from './Popover'
export { Toast, ToastStack } from './Toast'
export type { ToastItem } from './Toast'
export { BulkBar } from './BulkBar'
export type { BulkBarProps } from './BulkBar'
export { CommandList } from './CommandList'
export type { CommandListProps, CommandItem, CommandGroup } from './CommandList'

export { StatTile } from './StatTile'
export type { StatTileProps } from './StatTile'
export { Stepper } from './Stepper'
export type { StepperProps, Step } from './Stepper'
export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'
export { Skeleton, SkeletonRows } from './Skeleton'
export type { SkeletonProps } from './Skeleton'
export { Banner } from './Banner'
export type { BannerProps } from './Banner'
export { Working, LiveDot } from './Working'
