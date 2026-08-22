import sys, collections, datetime as dt
sys.path.insert(0,'/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/usage-tools')
import pg
P=lambda s: dt.datetime.fromisoformat(s.replace("Z","+00:00"))
om=pg.rows("outreach_messages?select=id,approved_at,sent_at,created_at,channel,direction,ai_model,message_type,send_blocked_reason&approved_at=not.is.null&order=approved_at.asc")
om=[r for r in om if P("2026-07-23T00:00:00+00:00")<=P(r["approved_at"])<P("2026-08-23T00:00:00+00:00")]
c=collections.Counter(r["approved_at"] for r in om)
dups={k:v for k,v in c.items() if v>1}
print("distinct approved_at instants:",len(c),"of",len(om))
print("instants shared by >1 row:",len(dups),"covering",sum(dups.values()),"rows")
print("top shared:",sorted(dups.items(),key=lambda kv:-kv[1])[:8])
# ms precision present?
print("sample approved_at values:", [r["approved_at"] for r in om[:5]])
# approved -> created lag
lags=sorted((P(r["approved_at"])-P(r["created_at"])).total_seconds() for r in om)
print(f"approve lag after row creation: p10={lags[len(lags)//10]:.0f}s median={lags[len(lags)//2]:.0f}s p90={lags[int(len(lags)*.9)]:.0f}s")
print("lag under 60s (i.e. auto-approved on creation):", sum(1 for l in lags if l<60))
print("by ai_model:",collections.Counter(r["ai_model"] for r in om).most_common(6))
print("by message_type:",collections.Counter(r["message_type"] for r in om).most_common(8))
print("by channel:",collections.Counter(r["channel"] for r in om).most_common())
