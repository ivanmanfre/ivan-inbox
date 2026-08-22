"""Step 2.6 AGING AND NEGLECT + 2.7 WEEK SHAPE."""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
NOW = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)
def days(s): return (NOW - P(s)).total_seconds() / 86400
def q(v): 
    v = sorted(v); return (v[0], v[len(v)//2], v[-1]) if v else (0,0,0)

print("=== 1. PENDING DM DRAFTS (the inbox queue: outbound, unsent, unapproved, unblocked) ===")
pend = pg.rows("outreach_messages?select=id,prospect_id,created_at,channel,message_type,snoozed_until,ai_model"
               "&direction=eq.outbound&sent_at=is.null&approved_at=is.null&send_blocked_reason=is.null&order=created_at.asc")
print(f"  n={len(pend)}")
ag = [days(r["created_at"]) for r in pend]
lo, md, hi = q(ag)
print(f"  age days: min={lo:.1f} median={md:.1f} max={hi:.1f}")
print(f"  older than 3d: {sum(1 for a in ag if a>3)}   older than 10d: {sum(1 for a in ag if a>10)}")
print(f"  snoozed (hidden until later): {sum(1 for r in pend if r.get('snoozed_until'))}")
print("  by channel:", collections.Counter(r["channel"] for r in pend).most_common())

print("\n=== 2. STALE-EXPIRED DRAFTS (the queue he did NOT clear: send_blocked_reason='stale_draft_expired_10d') ===")
st = pg.rows("outreach_messages?select=id,created_at,send_blocked_at&send_blocked_reason=eq.stale_draft_expired_10d")
w = [r for r in st if r.get("send_blocked_at") and days(r["send_blocked_at"]) <= 31]
print(f"  all time: {len(st)}   expired inside the 30-day window: {len(w)}  ({len(w)/31:.1f}/day of drafted work thrown away unseen)")

print("\n=== 3. THREADS WITH AN UNANSWERED LAST INBOUND ===")
msgs = pg.rows("outreach_messages?select=id,prospect_id,direction,sent_at,created_at,read_at,approved_at,send_blocked_reason,message_text&order=created_at.asc")
byp = collections.defaultdict(list)
for m in msgs: byp[m["prospect_id"]].append(m)
def ev(m): return m.get("sent_at") or m.get("created_at")
unans = []
for pid, ms in byp.items():
    ms = sorted(ms, key=lambda m: ev(m) or "")
    last = ms[-1]
    if last["direction"] == "inbound":
        unans.append((pid, days(ev(last)), last.get("read_at") is not None))
print(f"  threads whose newest message is inbound: {len(unans)}")
ages = [u[1] for u in unans]; lo, md, hi = q(ages)
print(f"  age days: min={lo:.1f} median={md:.1f} max={hi:.1f}")
for cut in (1, 3, 7, 14, 30):
    print(f"    unanswered >{cut}d: {sum(1 for a in ages if a>cut)}")
print(f"  of those, NEVER OPENED in this app (read_at IS NULL): {sum(1 for u in unans if not u[2])}")
recent = [u for u in unans if u[1] <= 30]
print(f"  arrived inside the 30-day window: {len(recent)}; never opened: {sum(1 for u in recent if not u[2])}")

print("\n=== 4. CONTENT DRAFTS: the piles, with age ===")
cd = pg.rows("carousel_drafts?select=id,status,client_id,created_at,updated_at,scheduled_at,published_at,source_post_id,board_visible,taxonomy")
cd = [r for r in cd if not (isinstance(r.get("taxonomy"), dict) and r["taxonomy"].get("deleted_by_operator"))]
print(f"  rows after the operator-deleted filter (content.ts:319): {len(cd)}")
for st in ("review", "error", "scheduled", "planned", "archived", "disqualified", "published"):
    g = [r for r in cd if r["status"] == st]
    if not g: continue
    a = [days(r["created_at"]) for r in g]; u = [days(r["updated_at"]) for r in g if r.get("updated_at")]
    lo, md, hi = q(a); _, mu, _ = q(u)
    lanes = collections.Counter(r["client_id"] or "ivan(NULL)" for r in g)
    print(f"  {st:14s} n={len(g):4d} age med={md:5.1f}d max={hi:5.1f}d  untouched med={mu:5.1f}d  lanes={dict(lanes)}")
    if st == "review":
        print(f"      review older than 7d: {sum(1 for x in a if x>7)}   older than 14d: {sum(1 for x in a if x>14)}   older than 30d: {sum(1 for x in a if x>30)}")

print("\n=== 5. STUCK SCHEDULED (content.ts:isStuckScheduled) ===")
stuck = [r for r in cd if r["status"] == "scheduled" and not r.get("source_post_id")
         and (not r.get("scheduled_at") or P(r["scheduled_at"]) < NOW)]
print(f"  n={len(stuck)}")
for r in stuck: print(f"    {r['id'][:8]} lane={r['client_id']} sched={r.get('scheduled_at')} age={days(r['created_at']):.1f}d")

print("\n=== 6. scheduled_posts: past-due and never posted ===")
sp = pg.rows("scheduled_posts?select=id,status,scheduled_at,posted_at,error_message,platform,created_at,post_kind")
print("  status distribution:", collections.Counter(r["status"] for r in sp).most_common())
overdue = [r for r in sp if r.get("scheduled_at") and P(r["scheduled_at"]) < NOW and not r.get("posted_at") and r["status"] not in ("cancelled", "failed")]
print(f"  scheduled in the past, posted_at still NULL, not cancelled/failed: {len(overdue)}")
for r in sorted(overdue, key=lambda r: r["scheduled_at"])[:12]:
    print(f"    {r['id'][:8]} status={r['status']} sched={r['scheduled_at'][:16]} {days(r['scheduled_at']):.1f}d overdue err={str(r.get('error_message'))[:60]}")

print("\n=== 7. THE WEEK'S SHAPE: posts per day, 2 weeks back and 2 weeks forward ===")
cal = collections.Counter()
for r in cd:
    if r.get("scheduled_at"): cal[(P(r["scheduled_at"]).date(), "carousel_drafts", r["status"])] += 1
for r in sp:
    if r.get("scheduled_at"): cal[(P(r["scheduled_at"]).date(), "scheduled_posts", r["status"])] += 1
d0 = NOW.date() - dt.timedelta(days=14)
print("  date        n  detail")
for i in range(29):
    d = d0 + dt.timedelta(days=i)
    items = {(src, st): n for (dd, src, st), n in cal.items() if dd == d}
    n = sum(items.values())
    mark = "  <-- today" if d == NOW.date() else ("  [FUTURE]" if d > NOW.date() else "")
    bar = "#" * n
    print(f"  {d} {n:2d} {bar:8s} {items if items else ''}{mark}")
