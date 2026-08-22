"""Steps 2.1/2.4/2.5 on the CONTENT lanes.
Human-only instruments here:
 - client_ideas.approved_at            <- Ivan approving a client idea
 - carousel_drafts.updated_at on rows now in an operator-only terminal state
   (archived / disqualified) = the moment he killed it
 - comment_feed.approved_at, ops_drafts.approved_at
 - lm_idea_candidates.status
"""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
W0, W1 = P("2026-07-23T00:00:00+00:00"), P("2026-08-23T00:00:00+00:00")
NOW = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)

def runs(ts, gap=90):
    ts = sorted(ts)
    if not ts: return []
    out, cur = [], [ts[0]]
    for a, b in zip(ts, ts[1:]):
        if (b - a).total_seconds() <= gap: cur.append(b)
        else: out.append(cur); cur = [b]
    out.append(cur); return out

def report(name, ts):
    ts = sorted(ts)
    if not ts: print(f"\n### {name}: 0 events"); return
    r = runs(ts); multi = [b for b in r if len(b) > 1]
    inr = sum(len(b) for b in multi)
    print(f"\n### {name}")
    print(f"  events={len(ts)} ({len(ts)/31:.1f}/day) active days={len(set(t.date() for t in ts))}/31")
    print(f"  sessions={len(r)}  runs of 2+={len(multi)}  events inside a run={inr} ({100*inr/len(ts):.0f}%)")
    print(f"  run lengths: {dict(sorted(collections.Counter(len(b) for b in r).items()))}")
    if multi:
        g = sorted((b[i+1]-b[i]).total_seconds() for b in multi for i in range(len(b)-1))
        print(f"  gap inside a run: min={g[0]:.0f}s median={g[len(g)//2]:.0f}s p90={g[int(len(g)*.9)]:.0f}s")
        print(f"  biggest runs: {sorted((len(b), b[0].isoformat()[:16]) for b in multi)[-6:]}")
    print("  UTC hours: " + " ".join(f"{k:02d}={v}" for k, v in sorted(collections.Counter(t.hour for t in ts).items())))
    print("  weekday Mon0: " + str(dict(sorted(collections.Counter(t.weekday() for t in ts).items()))))

inw = lambda s: s and W0 <= P(s) < W1

ci = pg.rows("client_ideas?select=id,client_id,status,created_at,approved_at,eligible_at,title,source_label,icp_score")
print("client_ideas status:", collections.Counter(r["status"] for r in ci).most_common())
report("CLIENT IDEA APPROVES (client_ideas.approved_at)", [P(r["approved_at"]) for r in ci if inw(r.get("approved_at"))])

cd = pg.rows("carousel_drafts?select=id,status,client_id,title,created_at,updated_at,scheduled_at,taxonomy,topic")
report("DRAFT KILLS (updated_at on rows now archived/disqualified)",
       [P(r["updated_at"]) for r in cd if r["status"] in ("archived", "disqualified") and inw(r.get("updated_at"))])
report("DRAFT SCHEDULES/PUBLISH TOUCHES (updated_at on scheduled/published rows)",
       [P(r["updated_at"]) for r in cd if r["status"] in ("scheduled", "published") and inw(r.get("updated_at"))])

cf = pg.rows("comment_feed?select=id,status,created_at,approved_at,commented_at,posted_at,feed_date")
print("\ncomment_feed status:", collections.Counter(r["status"] for r in cf).most_common())
report("COMMENT APPROVES (comment_feed.approved_at)", [P(r["approved_at"]) for r in cf if inw(r.get("approved_at"))])

od = pg.rows("ops_drafts?select=id,kind,client_id,created_at,approved_at,sent_at,send_blocked_reason")
print("\nops_drafts kind:", collections.Counter(r["kind"] for r in od).most_common())
print("ops_drafts pending (no approved_at, no sent_at):", sum(1 for r in od if not r.get("approved_at") and not r.get("sent_at")))
report("OPS APPROVES (ops_drafts.approved_at)", [P(r["approved_at"]) for r in od if inw(r.get("approved_at"))])

lm = pg.rows("lm_idea_candidates?select=id,status,source,created_at,scored_at,composite_score,promoted_draft_id,archived_reason")
print("\nlm_idea_candidates status:", collections.Counter(r["status"] for r in lm).most_common())
inwin = [r for r in lm if inw(r.get("created_at"))]
print("created in window:", len(inwin), "status:", collections.Counter(r["status"] for r in inwin).most_common())
print("pending backlog all time:", sum(1 for r in lm if r["status"] == "pending"))

print("\n=== REPETITION: duplicate titles across ALL carousel_drafts ===")
tc = collections.Counter((r["title"] or "").strip().lower() for r in cd if r.get("title"))
dups = {t: n for t, n in tc.items() if n > 1}
print(f"  distinct titles={len(tc)}  titles appearing more than once={len(dups)}  rows involved={sum(dups.values())}")
print(f"  duplicate rows as a share of the table: {100*(sum(dups.values())-len(dups))/len(cd):.1f}%")
for t, n in sorted(dups.items(), key=lambda kv: -kv[1])[:12]:
    sts = collections.Counter(r["status"] for r in cd if (r["title"] or "").strip().lower() == t)
    print(f"    {n}x {t[:62]!r} -> {dict(sts)}")

print("\n=== REPETITION: same TOPIC generated more than once ===")
tp = collections.Counter((r.get("topic") or "").strip().lower() for r in cd if r.get("topic"))
d2 = {t: n for t, n in tp.items() if n > 1}
print(f"  topics reused: {len(d2)}, rows: {sum(d2.values())}")
for t, n in sorted(d2.items(), key=lambda kv: -kv[1])[:6]:
    print(f"    {n}x {t[:70]!r}")
