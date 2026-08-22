import sys, collections, datetime as dt
sys.path.insert(0,'/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/usage-tools')
import pg
P=lambda s: dt.datetime.fromisoformat(s.replace("Z","+00:00"))
rs=pg.rows("outreach_messages?select=id,prospect_id,read_at,direction,created_at,sent_at&read_at=not.is.null&order=read_at.asc")
w=[r for r in rs if P("2026-07-23T00:00:00+00:00")<=P(r["read_at"])<P("2026-08-23T00:00:00+00:00")]
print("rows with read_at in window:",len(w),"distinct prospects:",len(set(r["prospect_id"] for r in w)))
print("distinct read_at instants:",len(set(r["read_at"] for r in w)))
print("direction split:",collections.Counter(r["direction"] for r in w).most_common())
c=collections.Counter(r["read_at"] for r in w)
print("sample multi-row instants:",[(k,v) for k,v in c.most_common(5)])
print("sample values:",[r["read_at"] for r in w[:6]])
# per-prospect distinct read instants (re-opens)
byp=collections.defaultdict(set)
for r in w: byp[r["prospect_id"]].add(r["read_at"][:19])
print("prospects opened once vs more:",collections.Counter(len(v) for v in byp.values()).most_common())
