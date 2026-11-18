// One decision per action id in this tab: a commit is sent at most once, and once Undo is tapped the
// hold is disarmed at once, before any network answer (Sol desk-ui r1 #1). Module level, so a remount
// or a second mount of the same row shares it.
export const committed = new Set<string>()
export const disarmed = new Set<string>()
/** Tests only. */
export function resetActionGuards(): void { committed.clear(); disarmed.clear() }
