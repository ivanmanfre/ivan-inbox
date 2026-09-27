import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { FrameCountsProvider } from './counts/useFrameCounts'
import type { Layout } from './places'
import { parseDHash } from './route'
import { FrameCtx, type Frame } from './shell/frame'
import { DConfirmProvider } from './ui/confirm'
import { ToastProvider } from './ui/toast'

// For page tests: render a D component inside the frame's providers without
// the network. Every count reader resolves to the numbers you pass (or zeros).
export type TestReaders = Parameters<typeof FrameCountsProvider>[0]['readers']

export const ZERO_READERS: NonNullable<TestReaders> = {
  dm: async () => ({ drafts: 0, needs: 0 }),
  content: async () => 0,
  ops: async () => ({ ivan: 0, risedtc: 0, arch: 0 }),
  nextCall: async () => ({ label: 'none booked this week', title: null, start: null }),
  bell: async () => ({ unreadGroups: 0, open: 0 }),
  alerts: async () => ({ rows: [], groups: [], critical: 0 }),
}

export function renderInFrame(ui: ReactElement, opts: { layout?: Layout; hash?: string; readers?: Partial<NonNullable<TestReaders>>; frame?: Partial<Frame> } = {}) {
  const layout = opts.layout ?? 'desktop'
  const frame: Frame = {
    layout, route: parseDHash(opts.hash ?? '#exp/d/lanes'), navigate: () => {},
    bellOpen: false, setBellOpen: () => {}, claudeOpen: false, setClaudeOpen: () => {}, openPalette: () => {},
    titleSlot: null, toolsSlot: null, ...opts.frame,
  }
  return render(
    <FrameCountsProvider readers={{ ...ZERO_READERS, ...opts.readers }}>
      <FrameCtx.Provider value={frame}>
        <div className={`d-app d-${layout}`}>
          <ToastProvider><DConfirmProvider>{ui}</DConfirmProvider></ToastProvider>
        </div>
      </FrameCtx.Provider>
    </FrameCountsProvider>,
  )
}
