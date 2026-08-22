import sys, collections, datetime as dt
sys.path.insert(0,'/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/usage-tools')
import pg
cd=pg.rows("carousel_drafts?select=id,status,client_id,title,created_at,updated_at,taxonomy&or=(status.eq.archived,status.eq.disqualified)&order=updated_at.asc")
c=collections.Counter(r["updated_at"] for r in cd)
print("rows:",len(cd),"distinct updated_at:",len(c))
print("top instants:",c.most_common(6))
print("sample raw values:",[r["updated_at"] for r in cd[-6:]])
# what do the big-instant rows look like
top=c.most_common(1)[0][0]
g=[r for r in cd if r["updated_at"]==top]
print("\nbiggest instant",top,"n=",len(g))
print(" lanes:",collections.Counter(r["client_id"] for r in g))
print(" statuses:",collections.Counter(r["status"] for r in g))
print(" taxonomy deleted_by_operator:",sum(1 for r in g if isinstance(r.get("taxonomy"),dict) and r["taxonomy"].get("deleted_by_operator")))
for r in g[:5]: print("  ",r["id"][:8],r["status"],str(r["title"])[:50])
