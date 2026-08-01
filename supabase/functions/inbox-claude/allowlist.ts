// The tenant allowlist, in ONE place.
//
// PARITY-SPEC §2 (the always-on injection) and DEPTH-SPEC §4 (the on-demand
// recall/brain recipes) both scope every read to these three client_ids. They are
// two different mechanisms — a server-side URL filter in the assembler, and a
// prose instruction the model executes with curl — and the one failure mode that
// would be invisible is the two drifting apart: the assembler tightened, the
// recipes still carrying a stale wider list, or vice versa.
//
// DEPTH-SPEC §7 makes this a build requirement: "the allowlist literal appears in
// exactly one constant shared with PARITY-SPEC §2 so the two can never drift
// apart." This module is that constant. Nothing else may declare it.
//
// AMENDMENTS A2 is why it matters more than tidiness: there is NO server-side
// tenancy enforcement on claude-brain-query's recall mode without client_ids
// (live probe: 3 of 5 rows came back ProSWPPP's). The scoping lives in this list
// and in the prose built from it. A plain model mistake, no attacker needed, is
// enough to read another tenant's memory if the list is ever widened here.

/** The only client_ids this surface may ever read. Baked; never caller-supplied. */
export const ALLOWLIST: readonly string[] = ['ivan', 'global', 'shared-tech']

/** `["ivan","global","shared-tech"]` — the JSON body form for claude-brain-query. */
export const ALLOWLIST_JSON = JSON.stringify(ALLOWLIST)

/** `ivan,global,shared-tech` — the PostgREST `in.(…)` form. */
export const ALLOWLIST_CSV = ALLOWLIST.join(',')

/** `"ivan","global","shared-tech"` — the prose form used inside the depth block. */
export const ALLOWLIST_QUOTED = ALLOWLIST.map((c) => `"${c}"`).join(',')
