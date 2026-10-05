# Inbox referral research and DM drafts

Opening a LinkedIn conversation whose latest inbound contains a handoff automatically researches the referred person. The lookup extracts the name as written, searches the name with the company, and requires the selected LinkedIn person-profile citation's metadata to contain both. Unnamed handoffs, namesakes, missing evidence and failed copy checks remain unresolved with a retry action.

The saved result appears alongside the original conversation with a DM addressed to the referred person, research sources, Copy DM and Open LinkedIn profile. It lives in the original prospect's enrichment data. It creates no prospect or outreach message, grants no sending approval and never enrolls the referral in an outreach sequence. LinkedIn connection status remains unverified.

The existing on-demand reply path remains available. Authentication uses the endpoint's existing owner allowlist; an unauthenticated referral request returned 401. Saving re-reads enrichment after research and uses a compare-and-set update to preserve concurrent changes.

Live check: Mallory Vaughan Patton's referral to Ben Patton resolved to the Saint Spritz CEO's public profile, https://www.linkedin.com/in/ben-patton-9834411aa. The DM was generated and persisted. The original conversation's message IDs remained unchanged.

Validation: 56 focused tests passed, Deno type check passed, changed frontend files passed Oxlint, and the production build passed. Desktop (1440px) and phone (375px) renders were inspected. Research loading, unresolved and error/retry states were exercised. Primary controls have 44px targets; the draft grows to show its complete text.

The full suite reported 340 passing files and seven failing files. Five also fail in the unchanged main checkout: editorialImport.pglite.test.ts and editorialNativeBridge.pglite.test.ts require an absent import-initial-batch.mjs fixture; editorialSelection.test.ts requires an absent snapshot; editorialGenerationRoutes.test.ts requires absent candidate JSON fixtures (including its Promo QA assertion); editorialRefresh.pglite.test.ts fails its existing transaction case. The outreachPerf.pglite.test.ts timeout and wb/magnet/index.test.tsx Edit-button failure both passed on isolated rerun. No unrelated editorial files were changed.
