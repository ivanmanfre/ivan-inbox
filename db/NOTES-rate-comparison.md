# Custom rate dates (2026-10-10)

`public.inbox_rate_comparison(date,date)` is a read-only operator RPC. Apply
`20261010_rate_comparison.sql` before deploying its UI. The matching rollback
removes only this new function.

The Lanes rate section and Custom range sheet show acceptance and reply rates
for Ivan, ARCH and RISE separately, with current campaign names as lanes. A
selection includes both dates in Europe/Warsaw. Its comparison is the immediately
preceding period with the same number of calendar days, including across DST.
The 7/30/90 presets end yesterday, the last completed Warsaw day.

Each prospect contributes its first confirmed invitation and first confirmed
LinkedIn DM from all history. Invitations require a successful connection_request
log within +/-10 minutes of the sent row, matching the send monitor's rule. DMs
require a delivery receipt. Blocked sends, reactions, email and InMail do not
enter these DM cohorts. Campaign membership and client ownership are current
values; null campaign client_id resolves to Ivan.

Rates count outcomes within 72 hours, using only first touches that have had the
full observation window at read time. Younger sends are shown as pending. Empty
samples have no rate; empty comparison samples have no percentage-point change.
Each displayed rate includes its outcome and denominator counts.

These figures can differ from the existing provisional send-monitor bars:
comparisons exclude young sends from both numerator and denominator and require
DM receipts. Existing bars are available under the labelled monitor disclosure;
the Custom range acceptance total also includes later acceptances.

Access uses the existing Ivan operator roster. Anonymous execution is revoked;
service_role and roster operators can read all three client results. No source
rows, workflows, views or existing RLS policies are changed.

Verification: 169 tests across the Lanes and rate suites passed; production build
and lint passed. Live 7/30/90-day and custom RPC calls returned separate results
for all three clients, with counts bounded by mature denominators. Authenticated
operator access and denial for non-operators/anonymous callers were checked.
Desktop1440/mobile375 default, custom, empty, loading and error states were
checked using the real component; default/custom reads used live RPC results.
The broad repository test run had unrelated missing external editorial artifacts
and PGlite timeouts under its default concurrency; the relevant suites passed
with two workers. Both review findings were fixed and reproduced in regression
tests before deployment.
