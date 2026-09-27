import { useEffect, useSyncExternalStore } from 'react'
import type { WbCommand } from '../../exp/v2c/commandSource'

// Page commands for the ⌘K palette. A page that has verbs worth a keyboard
// path registers them while it is mounted:
//
//   useDCommands(useMemo(() => [{ id: 'dms.next', title: 'Next conversation', group: 'Move',
//     key: 'j', hint: '...', ready: true, run: next }], [next]))
//
// The palette lists them above the frame's own Go / Claude rows.
let current: WbCommand[] = []
const subs = new Set<() => void>()
const owners = new Map<symbol, WbCommand[]>()

function publish() {
  current = [...owners.values()].flat()
  for (const f of subs) f()
}

export function useDCommands(cmds: WbCommand[]) {
  useEffect(() => {
    const k = Symbol('d-cmds')
    owners.set(k, cmds)
    publish()
    return () => { owners.delete(k); publish() }
  }, [cmds])
}

export function usePageCommands(): WbCommand[] {
  return useSyncExternalStore(
    f => { subs.add(f); return () => { subs.delete(f) } },
    () => current,
    () => current,
  )
}
