"""Is the Stuck Sentinel premature? Count errored rows where work continued AFTER it fired."""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
rs = pg.rows("carousel_drafts?select=id,status,client_id,agent_log,post_body,created_at,updated_at&status=eq.error")
fired = after = 0; gaps = []
for r in rs:
    al = r.get("agent_log")
    if not isinstance(al, list): continue
    idx = [i for i, e in enumerate(al) if isinstance(e, dict) and e.get("agent") == "Stuck Sentinel"]
    if not idx: continue
    fired += 1
    i = idx[0]
    later = [e for e in al[i+1:] if isinstance(e, dict) and e.get("ts")]
    if later:
        after += 1
        gaps.append((P(later[-1]["ts"]) - P(al[i]["ts"])).total_seconds() / 60)
print(f"errored rows carrying a Stuck Sentinel entry: {fired} / {len(rs)}")
print(f"  ... of which the pipeline logged MORE work after the sentinel fired: {after}")
gaps.sort()
if gaps:
    print(f"  minutes of further work after the 'stuck' verdict: min={gaps[0]:.0f} median={gaps[len(gaps)//2]:.0f} max={gaps[-1]:.0f}")
print("\nDistinct agents seen AFTER a sentinel entry:")
c = collections.Counter()
for r in rs:
    al = r.get("agent_log")
    if not isinstance(al, list): continue
    idx = [i for i, e in enumerate(al) if isinstance(e, dict) and e.get("agent") == "Stuck Sentinel"]
    if not idx: continue
    for e in al[idx[0]+1:]:
        if isinstance(e, dict): c[e.get("agent")] += 1
print(c.most_common())
