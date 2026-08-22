"""Step 2.3 ERRORS. Read every errored draft's actual error text and cluster it."""
import sys, os, collections, json, re, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg

rs = pg.rows("carousel_drafts?select=id,title,status,type,client_id,created_at,updated_at,taxonomy,qa,agent_log,video_status,ig_error,render_engine,board_visible&status=eq.error&order=created_at.desc")
print("errored rows:", len(rs))
now = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)
seen = collections.Counter()
for r in rs:
    tax = r.get("taxonomy") or {}
    em = tax.get("error_message") if isinstance(tax, dict) else None
    print("-" * 100)
    age = (now - dt.datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))).days
    print(f"id={r['id'][:8]} client={r['client_id']} type={r['type']} age={age}d bv={r['board_visible']} title={str(r['title'])[:60]!r}")
    print(f"  taxonomy_keys={list(tax.keys()) if isinstance(tax,dict) else type(tax)}")
    print(f"  error_message={str(em)[:400]!r}")
    if r.get("ig_error"): print(f"  ig_error={str(r['ig_error'])[:200]!r}")
    if r.get("video_status"): print(f"  video_status={r['video_status']}")
    q = r.get("qa")
    if isinstance(q, dict): print(f"  qa_keys={list(q.keys())[:12]} decision={q.get('decision')} total={q.get('total')}")
