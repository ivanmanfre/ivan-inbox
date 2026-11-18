// One decision per action id in this tab (Sol desk-ui r1/r2 #1). Module level, so a remount or a
// second mount of the same row shares it:
//  - inFlight: a commit or cancel request is on the wire; nothing else is sent for that id.
//  - disarmed: the hold may never commit by itself again (Undo tapped, or an op failed).
//  - failedOp: the last op that failed with a network or server error, so the row offers it again.
export const inFlight = new Map<string, 'commit' | 'cancel' | 'undo'>()
export const disarmed = new Set<string>()
export const failedOp = new Map<string, { op: 'commit' | 'cancel' | 'undo'; error: string }>()
/** Tests only. */
export function resetActionGuards(): void { inFlight.clear(); disarmed.clear(); failedOp.clear() }
