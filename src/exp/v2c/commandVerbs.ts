/* ==========================================================================
   src/exp/v2c/commandVerbs.ts — THE FOUR VERBS E4 ADDS TO THE PALETTE (goal
   run inbox-repair-floor-and-21st-moves-2026-09-12).

   kokonutd/action-search-bar's rule is that the results are VERBS — things you
   do, not places you read. The palette this app already had could do three of
   them (`j`/`k`, the bulk caps, `Go to <job>`) and reach a person only if that
   person's row happened to be one of the ~12 the DMs list has WINDOWED onto the
   screen. Ivan's inbox is 1,354 conversations. So:

     People  ·  open anyone in the loaded corpus, by name or by company
     Go      ·  Claude's drawer, the one place on the canvas that is not a job
     Claude  ·  a fresh bot thread
     Thread  ·  push the open conversation's draft to later

   🔴 EVERY ONE OF THESE IS A ROUTE OR AN OPENER. Not one of them writes:

     · openPerson  → the same 'wb-open' event the cross-object find already
                     dispatches; Shell moves to DMs and opens the peer.
     · openChat    → Shell's own `openDrawer`, which the rail's Claude row runs.
     · newChatThread → `chat.newThread()`, the handler ThreadMenu's own "New
                     thread" item calls. It starts an empty bot thread.
     · snooze      → CLICKS THE CONVERSATION'S OWN "Later" BUTTON. The palette
                     does not pick the date, does not reach the parking write in
                     lib/inbox.ts, and does not know what a draft id is.
                     Conversation.tsx keeps the one write path, exactly as
                     CommandLayer's Escape presses a peer's own close control
                     rather than reaching into the shell's state.

                     (The test below bans the write helpers' NAMES from this
                     file outright, comments included — which is why none of
                     them is spelled out above.)

   There is no approve verb here, no bulk promotion, and nothing that puts a
   message in front of a person. `commandVerbs.test.ts` walks every handler in
   this file and pins that.
   ========================================================================== */
import type { IconName } from '../../ds/icons'
import type { Thread } from '../../lib/inbox'
import { LANE_VALUES, STAGE_VALUES, stageValue } from '../../lib/filterTokens'
import type { WbCommand } from './commandSource'

/** One loaded conversation, as the palette needs it: a name to draw, a line of
 *  context under it, and the extra text it can be FOUND by. */
export type PersonEntry = {
  id: string
  name: string
  /** The context column: lane · stage. */
  sub: string
  /** Matched but not printed — the company. See commandRank.matchScore. */
  search: string
}

const labelOf = (values: { value: string; label: string }[], v: string | null): string | null =>
  (v === null ? null : values.find(x => x.value === v)?.label ?? null)

/**
 * Every loaded conversation as a palette row. The lane and the stage come from
 * E2's own registry (`LANE_VALUES`, `STAGE_VALUES`, `stageValue`) rather than
 * from a second mapping written here: a filter token reading "lane is Rise" and
 * a palette row reading something else about the same conversation is how two
 * controls start describing one row two ways.
 *
 * A field the row does not carry prints NOTHING rather than a guess — the same
 * rule matchToken states for a null value (D10.4).
 */
export function peopleFromThreads(threads: Thread[]): PersonEntry[] {
  return threads.map(t => {
    const lane = labelOf(LANE_VALUES, t.client_id || null)
    const stage = labelOf(STAGE_VALUES, stageValue(t))
    const bits = [lane, stage].filter((s): s is string => s !== null)
    return {
      id: t.prospect_id,
      name: t.prospect_name,
      sub: bits.length > 0 ? bits.join(' · ') : 'no lane on this row',
      search: t.prospect_company ?? '',
    }
  })
}

export type VerbCtx = {
  people: PersonEntry[]
  openPerson: (id: string) => void
  openChat: () => void
  newChatThread: () => void
  /** A conversation is open beside the work column. */
  threadOpen: boolean
  /**
   * The name on the open conversation's own "Later" control, when it draws one.
   * null means there is nothing to push — no conversation, or a conversation
   * whose draft is already parked (or which has no draft at all).
   */
  snoozeOn: string | null
  snooze: () => void
}

const ICON: Record<string, IconName> = {
  person: 'person', chat: 'ask', fresh: 'add', later: 'time',
}

/**
 * The four verbs, as WbCommands. Built by `buildCommands` so the `?` sheet and
 * the palette keep reading ONE array — a command that existed in one and not
 * the other is the drift commandSource.ts's header was written against.
 */
export function e4Commands(c: VerbCtx): WbCommand[] {
  const out: WbCommand[] = [
    {
      id: 'go.chat',
      title: 'Go to Claude',
      group: 'Go',
      icon: ICON.chat,
      key: null,
      hint: 'Docks the Claude drawer beside your work.',
      ready: true,
      run: () => c.openChat(),
    },
    {
      id: 'claude.new',
      title: 'New Claude thread',
      group: 'Claude',
      icon: ICON.fresh,
      key: null,
      hint: 'Opens the drawer on a fresh thread. Nothing leaves this app.',
      ready: true,
      run: () => c.newChatThread(),
    },
    {
      id: 'thread.later',
      title: 'Push this conversation to later',
      group: 'Thread',
      icon: ICON.later,
      key: null,
      hint: c.snoozeOn
        ? `Opens the date picker on ${c.snoozeOn}. You pick the day; nothing is written from here.`
        : 'Opens the date picker on the conversation beside your work.',
      ready: c.snoozeOn !== null,
      reason: c.threadOpen
        ? 'this conversation has nothing waiting that could be pushed'
        : 'no conversation is open beside your work',
      run: () => c.snooze(),
    },
  ]

  // Everyone in the loaded corpus, not only the dozen rows the window has
  // drawn. The list is long on purpose and `rankCommands` caps what is DRAWN at
  // eight; capping what is BUILT would mean the 1,300th conversation could not
  // be typed for at all, which is the whole reason this band exists.
  for (const p of c.people) {
    out.push({
      id: `person.${p.id}`,
      title: `Open ${p.name}`,
      group: 'People',
      icon: ICON.person,
      key: null,
      hint: p.sub,
      search: p.search,
      ready: true,
      run: () => c.openPerson(p.id),
    })
  }

  return out
}
