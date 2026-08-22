import sys, json
sys.path.insert(0, "/Users/ivanmanfredi/Desktop/ivan-inbox-pw-b/goal-runs/workbench-polish-2026-08-22-out/evidence/usage-tools")
import pg

rows = pg.rows("carousel_drafts?status=eq.error&select=id,client_id,title,post_body,taxonomy,qa_verdict:qa->>verdict,qa_score:qa->>score,agent_log&order=updated_at.desc")
print("N =", len(rows))
json.dump(rows, open("/private/tmp/claude-501/-Users-ivanmanfredi-Desktop-Ivan---Content-System/e92e01da-e5fc-432a-abed-6fa98817c85a/scratchpad/err55.json","w"))

# is last element always max ts?
bad = 0
for r in rows:
    log = r.get("agent_log") or []
    if not isinstance(log, list) or not log: continue
    ts = [e.get("ts","") for e in log if isinstance(e, dict)]
    if ts and ts[-1] != max(ts): bad += 1
print("rows where last element is NOT max ts:", bad)

# distinct terminal agents
from collections import Counter
c = Counter()
for r in rows:
    log = r.get("agent_log") or []
    c[log[-1].get("agent") if isinstance(log, list) and log and isinstance(log[-1], dict) else "(no log)"] += 1
for k,v in c.most_common(): print(f"  {v:3d}  {k}")
print("empty post_body:", sum(1 for r in rows if not (r.get("post_body") or "").strip()))
