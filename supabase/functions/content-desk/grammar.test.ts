// GRAMMAR.md, table-driven (round 18): every row runs against the real resolver functions.
// Made-up data only (public repo). "Today" is Wednesday 2026-11-18, Warsaw.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { identify, parseDestination } from './target.ts'
import { pickChips, roundTrips, sayItAs } from './actions.ts'
import type { Draft } from './brief.ts'

const TODAY = '2026-11-18'

// ---- Rule 2: destination (moves only) --------------------------------------------------------------
// [input, expected date, expected time] for accepted rows; [input, null, null] for rejected rows
const DEST: [string, string | null, string | null][] = [
  // <weekday>: the next occurrence AFTER today
  ['move it to friday', '2026-11-20', null],
  ['move it to wednesday', '2026-11-25', null],
  ['move it to fri', '2026-11-20', null],
  ['move it to Monday', '2026-11-23', null],
  // <day> <month> [<yyyy>]
  ['move it to 27 nov', '2026-11-27', null],
  ['move it to 27 November 2027', '2027-11-27', null],
  ['move it to 10 nov', '2027-11-10', null],
  // <month> <day> [<yyyy>]
  ['move it to nov 27', '2026-11-27', null],
  ['move it to November 27 2026', '2026-11-27', null],
  // <weekday> <day> <month> [<yyyy>]
  ['move it to friday 27 nov', '2026-11-27', null],
  ['move it to Friday 27 November 2026', '2026-11-27', null],
  ['put the cold brew one on tuesday 9 march', '2027-03-09', null],
  // optional "at H:MM" / "at HH:MM", 24-hour, two-digit minutes
  ['move it to friday at 9:30', '2026-11-20', '09:30'],
  ['move it to friday at 09:30', '2026-11-20', '09:30'],
  ['move it to 27 nov at 23:59', '2026-11-27', '23:59'],
  ['move it to 27 nov at 0:00', '2026-11-27', '00:00'],
  // sources and quoted text are not the destination
  ["move tomorrow's post to friday", '2026-11-20', null],
  ['move the post on friday to monday', '2026-11-23', null],
  ['move the post that starts "Friday at 7am I ship" to monday', '2026-11-23', null],
  // rejected: no write, the "Say it as" line
  ['move it to today', null, null],
  ['move it to tomorrow', null, null],
  ['move it to next friday', null, null],
  ['move it to this friday', null, null],
  ['move it to friday at 9', null, null],
  ['move it to friday at 9am', null, null],
  ['move it to friday 4pm', null, null],
  ['move it to friday at noon', null, null],
  ['move it to friday 10:45', null, null],
  ['move it to friday at 10:45:30', null, null],
  ['move it to friday at 9:5', null, null],
  ['move it to friday at 24:00', null, null],
  ['move it to friday at 9:60', null, null],
  ['move it to 31 feb', null, null],
  ['move it to monday 9 march', null, null],
  ['move it to 2027-03-09', null, null],
  ['move it to friday or monday', null, null],
  ['move it to friday at 9:00 or 10:00', null, null],
  ['move it to 9th march', null, null],
  ['move it to nov 27, 2026', null, null],
  ['move it to friday, 27 nov', null, null],
  ['move it friday', null, null],
  ['move it until friday', null, null],
  ['move it to next week', null, null],
  ['move it', null, null],
  ['move the cold brew at 7am one to friday', null, null],
]

Deno.test('GRAMMAR rule 2: destination forms, accepted and rejected', () => {
  for (const [input, date, time] of DEST) {
    const r = parseDestination(input, TODAY)
    if (date) assert(r.ok && r.date === date && r.time === time, `${input} -> ${JSON.stringify(r)}`)
    else assert(!r.ok, `${input} should be rejected, got ${JSON.stringify(r)}`)
  }
  assert(DEST.length >= 40)
  assertEquals(sayItAs('date'), 'Say it as: move "<opener words>" to <day> [at HH:MM]')
})

// ---- Rule 1: target ---------------------------------------------------------------------------------
const C = [
  { id: 'cold', first_line: 'Cold brew at 7am and a 40 minute queue for a café that opened last week.', day: 'undated' },
  { id: 'ferry', first_line: 'The Gdańsk ferry to Hel takes about 50 minutes and nobody on it was looking at LinkedIn.', day: 'undated' },
  { id: 'amber', first_line: 'Amber sellers in Gdańsk old town quote prices like a sales call.', day: 'undated' },
  { id: 'tram', first_line: 'Tram 33 at rush hour is the best market research I do all week.', day: '2027-03-16' },
  { id: 'tmrw', first_line: 'A DM that got a reply', day: '2026-11-19' },
  { id: 'fri', first_line: 'Outreach starts with a free resource', day: '2026-11-20' },
  { id: 'tday', first_line: 'Inbound beats cold for small teams', day: '2026-11-18' },
]
const dest = (t: string) => { const d = parseDestination(t, TODAY); return d.ok ? d.span : null }

// [input, kind, expected ids (sorted); [] = act on none]
const TARGET: [string, string, string[]][] = [
  // T2: every token left after verb, destination, frame words and the trailing clause is in exactly one opener
  ['approve the cold brew one', 'approve', ['cold']],
  ['approve the gdansk one', 'approve', ['amber', 'ferry']],
  ['delete the gdansk ferry one, it makes no sense', 'delete', ['ferry']],
  ['remove the date from the tram one', 'undate', ['tram']],
  ['attach this photo to the cold brew one', 'photo_attach', ['cold']],
  ['redo the tram one, more about the business, less about the city', 'redo', ['tram']],
  ['put the cold brew one on tuesday 9 march', 'date', ['cold']],
  ['move the cold brew one to friday at 9:30', 'date', ['cold']],
  ['approve "a 40 minute queue"', 'approve', ['cold']],
  ['please approve the cold brew one', 'approve', []],
  ['approve the cold brew one please', 'approve', []],
  ['approve the cold brew #100 one', 'approve', []],
  ['approve the 100th cold brew one', 'approve', []],
  ['approve the cold brew one from November 19', 'approve', []],
  ['approve the brewing one', 'approve', []],
  ['approve the one', 'approve', []],
  ['approve #2', 'approve', []],
  ['approve the second one', 'approve', []],
  // T3: held kinds only, exactly the four phrases
  ["pull tomorrow's post", 'pull', ['tmrw']],
  ["approve friday's post", 'approve', ['fri']],
  ['delete the post on friday', 'delete', ['fri']],
  ["pull today's post", 'pull', ['tday']],
  ["move tomorrow's post to friday", 'date', []],
  ["remove the date from tomorrow's post", 'undate', []],
  ["attach this photo to tomorrow's post", 'photo_attach', []],
  ["redo tomorrow's post", 'redo', []],
  ['pull the post tomorrow', 'pull', []],
  ["pull tomorrow's 2 post", 'pull', []],
  ['pull the one on friday', 'pull', []],
  ["pull tomorrow's big post", 'pull', []],
  ['pull "tomorrow" post', 'pull', []],
  ['pull next friday\'s post', 'pull', []],
]

Deno.test('GRAMMAR rule 1: T2 opener match and T3 day form, accepted and rejected', () => {
  for (const [input, kind, want] of TARGET) {
    const r = identify(input, C, { today: TODAY, kind, destSpan: kind === 'date' ? dest(input) : null })
    const got = want.length === 1 ? (r.ids.length === 1 ? r.ids : []) : r.ids.length === 1 ? ['WRONG:' + r.ids[0]] : r.ids.slice().sort()
    // a row that expects act-on-none passes on zero ids or several ids (chips), never on exactly one
    if (want.length === 0) assert(r.ids.length !== 1, `${input} (${kind}) must not resolve, got ${JSON.stringify(r)}`)
    else assertEquals(got, want, `${input} (${kind}) -> ${JSON.stringify(r)}`)
  }
  assert(TARGET.length >= 30)
})

Deno.test('GRAMMAR rule 1 T3: exactly one live ELIGIBLE draft dated that day', () => {
  const two = [...C, { id: 'tmrw2', first_line: 'Another invented opener', day: '2026-11-19' }]
  assertEquals(identify("pull tomorrow's post", two, { today: TODAY, kind: 'pull' }).ids.sort(), ['tmrw', 'tmrw2'])   // two: act on none
  const elig = two.map((c) => ({ ...c, ok: c.id !== 'tmrw2' }))
  assertEquals(identify("pull tomorrow's post", elig, { today: TODAY, kind: 'pull' }).ids, ['tmrw'])
})

Deno.test('GRAMMAR rule 1 T1: every chip is a T2 form that resolves to its own draft alone', () => {
  const ds: Draft[] = C.map((c) => ({ id: c.id, status: 'review', type: 'text', scheduled_at: null, published_at: null, first_line: c.first_line, title: '', belief: null, vehicle: null,
    recipe: null, qa_verdict: null, is_copy: false, photos: 0, brain: false, human_edited: false, slot_kind: null, selling: false, chars: 0, created_at: '2026-11-10T10:00:00Z', fixture: null }))
  for (const kind of ['approve', 'delete', 'pull', 'redo', 'undate', 'photo_attach']) {
    for (const d of ds) {
      const [chip] = pickChips({ kind }, [d], ds)
      assert(/^[a-z ]+ "[^"]+"$/.test(chip.send), chip.send)
      assert(roundTrips(chip.send, d.id, ds, kind), `${kind}: ${chip.send}`)
    }
  }
})
