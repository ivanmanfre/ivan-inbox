"""Step 2.2/2.6: every queue in the app, sized and aged, ranked by pile size."""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
NOW = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)
d = lambda s: (NOW - P(s)).total_seconds() / 86400
def med(v): v = sorted(v); return v[len(v)//2] if v else 0

piles = []
def pile(name, rows, stamp="created_at", note=""):
    if not rows: piles.append((name, 0, 0, 0, note)); return
    a = [d(r[stamp]) for r in rows if r.get(stamp)]
    piles.append((name, len(rows), med(a), max(a) if a else 0, note))

cd = pg.rows("carousel_drafts?select=id,status,client_id,created_at,updated_at,scheduled_at,taxonomy")
cd = [r for r in cd if not (isinstance(r.get("taxonomy"), dict) and r["taxonomy"].get("deleted_by_operator"))]
pile("content drafts in REVIEW (waiting on Ivan)", [r for r in cd if r["status"] == "review"], note="carousel_drafts.status='review'")
pile("content drafts in ERROR (no retry button)", [r for r in cd if r["status"] == "error"], note="carousel_drafts.status='error'")
pile("content drafts REVIEW with no scheduled_at", [r for r in cd if r["status"] == "review" and not r.get("scheduled_at")], note="unqueued review rows")

ci = pg.rows("client_ideas?select=id,client_id,status,created_at,approved_at,eligible_at,icp_score")
pile("client ideas STAGED (never approved)", [r for r in ci if r["status"] == "staged"], note="client_ideas.status='staged'")

lm = pg.rows("lm_idea_candidates?select=id,status,created_at,composite_score,source")
pile("lm idea candidates REVIEWING (dead row per project memory)", [r for r in lm if r["status"] == "reviewing"], note="lm_idea_candidates.status='reviewing'")

od = pg.rows("ops_drafts?select=id,kind,client_id,created_at,approved_at,sent_at,send_blocked_reason")
pile("ops drafts never approved and never sent", [r for r in od if not r.get("approved_at") and not r.get("sent_at")], note="ops_drafts")

cf = pg.rows("comment_feed?select=id,status,created_at,feed_date")
pile("comment feed PENDING", [r for r in cf if r["status"] == "pending"], note="comment_feed.status='pending'")
pile("comment feed EXPIRED (aged out unactioned)", [r for r in cf if r["status"] == "expired"], note="comment_feed.status='expired'")

om = pg.rows("outreach_messages?select=id,direction,sent_at,approved_at,send_blocked_reason,created_at,snoozed_until")
pile("DM drafts pending approval", [r for r in om if r["direction"] == "outbound" and not r.get("sent_at") and not r.get("approved_at") and not r.get("send_blocked_reason")], note="the inbox queue")
pile("DM drafts EXPIRED unseen (stale_draft_expired_10d)", [r for r in om if r.get("send_blocked_reason") == "stale_draft_expired_10d"], note="thrown away by the 10-day sweeper")

sc = pg.rows("scans?select=id,status,created_at,completed_at,email_sent_at")
print("scans status:", collections.Counter(r["status"] for r in sc).most_common())
pile("scans not completed", [r for r in sc if r["status"] not in ("complete", "completed", "done")], note="scans.status")

print(f"\n{'QUEUE':52s} {'n':>5s} {'med age d':>10s} {'oldest d':>9s}  source")
for n, c, m, o, note in sorted(piles, key=lambda p: -p[1]):
    print(f"{n:52s} {c:5d} {m:10.1f} {o:9.1f}  {note}")

print("\n=== ops_drafts pending, by kind and age ===")
pend = [r for r in od if not r.get("approved_at") and not r.get("sent_at")]
for k, n in collections.Counter(r["kind"] for r in pend).most_common():
    a = [d(r["created_at"]) for r in pend if r["kind"] == k]
    print(f"  {k:18s} n={n:3d} med_age={med(a):.1f}d oldest={max(a):.1f}d")

print("\n=== client_ideas staged, by lane and score ===")
stg = [r for r in ci if r["status"] == "staged"]
print("  lanes:", collections.Counter(r["client_id"] for r in stg).most_common())
a = [d(r["created_at"]) for r in stg]
print(f"  age: med={med(a):.1f}d oldest={max(a):.1f}d   older than 14d: {sum(1 for x in a if x>14)}")
