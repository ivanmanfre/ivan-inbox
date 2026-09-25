// The live voice screen, lazy-imported by the Claude screen (D7 contract):
//   <LiveVoice onClose send turns />, rendered full-screen while voice is open,
//   opened from the composer's lime button or the `#claude/voice` deep link.
export { LiveVoice } from './LiveVoice'
export type { LiveVoiceProps } from './LiveVoice'

/** The deep link that opens the Claude section straight into live voice. */
export const openLiveVoiceHash = '#claude/voice'
