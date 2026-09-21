/* ==========================================================================
   src/lib/ccScenarios.ts — the `?wbmock=cc:<name>` fixtures.

   Five of the operator states cannot be reached by clicking on a healthy
   backend: a closed sending window, a spent cap, an open refusal episode, a
   reading we could not take, and a snapshot that carries no recurrence ledger.
   They are reachable by URL instead, the same move `src/exp/v2c/mock.ts`
   already makes for a failed fetch.

   Vite cannot import from outside the repo, so builder A's
   `examples/scenarios/<name>.json` files are COPIED into ./cc-fixtures/ and
   imported from there. Each import is dynamic, so a fixture is a separate chunk
   and none of them ship in the first load of the real app.
   ========================================================================== */
export const SCENARIO_NAMES = [
  'healthy', 'outside_window', 'capacity_reached', 'incident', 'unknown', 'partial', 'empty',
  'rate_limited',
] as const
export type ScenarioName = (typeof SCENARIO_NAMES)[number]

export async function loadScenario(name: ScenarioName): Promise<unknown> {
  // A development lever, and it says so rather than quietly serving a fixture to
  // a real reader: nothing in the shipped app may render invented figures.
  if (!import.meta.env.DEV) throw new Error('scenario fixtures are a development lever and are not served by the shipped app')
  switch (name) {
    case 'healthy': return (await import('./cc-fixtures/healthy.json')).default
    case 'outside_window': return (await import('./cc-fixtures/outside_window.json')).default
    case 'capacity_reached': return (await import('./cc-fixtures/capacity_reached.json')).default
    case 'incident': return (await import('./cc-fixtures/incident.json')).default
    case 'unknown': return (await import('./cc-fixtures/unknown.json')).default
    case 'partial': return (await import('./cc-fixtures/partial.json')).default
    // The live 2026-09-20 payload, unmutated: LinkedIn refusing invitations on
    // Ivan's and Davorin's seats with HTTP 422 errors/cannot_resend_yet.
    case 'rate_limited': return (await import('./cc-fixtures/rate_limited.json')).default
    // `empty` is the ABSENCE of a payload, not a payload — the adapter answers
    // `unavailable` for it and never reaches this loader.
    case 'empty': throw new Error('the empty scenario has no payload by definition')
  }
}
