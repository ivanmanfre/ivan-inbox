/* ==========================================================================
   FIXTURE HARNESS — W5 checker reachability (Phase-2 fix pass, must-fix 2 /
   orchestrator ruling c).

   Renders `EvidenceBlock` directly -- no Shell chrome, no rail, no glance
   counts, no lane-registry read, no `StrategyView` (which also mounts
   `ProposalsBlock`/`useStrategy`/`useLanes`, none of which the checker
   exercises and all of which issue real REST reads that have nowhere real
   to land against this build's placeholder `.env` Supabase host). Two
   problems, both measured, drove this shape:

     1. The full Shell took ~7-8s to first paint the Strategy tab row in this
        served build, while the checker's own `page.goto(url,
        {waitUntil:'networkidle'})` resolves in under 1s (every failing
        request settles almost immediately against a placeholder host) --
        so the checker queried for the evidence markers on a page that had
        not rendered them yet and reported FAIL.
     2. Even once that was fixed, `StrategyView`'s own always-mounted reads
        (`useStrategy`, `useLanes`, `ProposalsBlock`'s `fetchProposals`) hit
        `/rest/v1/...` against the placeholder host and log a genuine
        "Failed to load resource: 404" console error per request -- there is
        no way to make an arbitrary REST path succeed against a static
        `vite preview` server, and the checker's zero-console-error bar is
        correct to enforce (a real broken read should never pass silently).

   `EvidenceBlock` itself never reaches the network under the DEV fixture
   lever (`readPack`'s `?evidenceFixture=` branch resolves from a local
   dynamic import, not `fetch`), so it is the one real, unmodified piece of
   this feature that can be exercised with zero network calls at all. This
   harness exists ONLY for that DEV-only bypass in `App.tsx`; nothing
   reachable from a normal signed-in session ever renders it, and the
   Recommendations/Notes/lane-switch surface this skips is unaffected --
   `strategy.tsx` and `ProposalsBlock.tsx` are untouched by this fix pass.
   ========================================================================== */
import { Head, Screen } from '../../kit'
import { EvidenceBlock } from './EvidenceBlock'
import type { ContentLane } from '../../../lib/content'

export function FixtureHarness({ lane = 'ivan' }: { lane?: ContentLane }) {
  return (
    <Screen className="a-ct">
      <Head title="Strategy" sub="Evidence (fixture harness)" />
      <EvidenceBlock lane={lane} />
    </Screen>
  )
}
