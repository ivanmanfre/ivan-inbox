"""Step 2.3 deeper: cluster errored drafts by cause, with recoverability evidence."""
import sys, os, collections, re, json, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg

rs = pg.rows("carousel_drafts?select=id,title,type,client_id,created_at,updated_at,taxonomy,qa,agent_log,post_body,slides,image_urls,source_ref,source_label&status=eq.error&order=created_at.desc")
now = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))

buckets = collections.defaultdict(list)
for r in rs:
    tax = r.get("taxonomy") if isinstance(r.get("taxonomy"), dict) else {}
    em = tax.get("error_message")
    has_body = bool((r.get("post_body") or "").strip())
    has_slides = bool(r.get("slides"))
    if em and "Generation stuck" in em:
        mins = int(re.search(r"within (\d+) minutes", em).group(1))
        key = "A_watchdog_timeout"
    elif em:
        key = "C_other_message"
        mins = None
    elif "generating_started_at" in tax:
        key = "B_silent_no_message_but_gen_started"
        mins = None
    else:
        key = "D_silent_no_message_no_marker"
        mins = None
    buckets[key].append((r, mins, has_body, has_slides))

print("== CLUSTERS ==")
for k, v in sorted(buckets.items()):
    lanes = collections.Counter(x[0]["client_id"] or "ivan(NULL)" for x in v)
    bodies = sum(1 for x in v if x[2])
    ages = sorted((now - P(x[0]["created_at"])).days for x in v)
    print(f"\n{k}: n={len(v)} lanes={dict(lanes)} rows_with_post_body={bodies} median_age={ages[len(ages)//2]}d oldest={ages[-1]}d")
    if k == "A_watchdog_timeout":
        ms = sorted(x[1] for x in v)
        print(f"   stall minutes: min={ms[0]} median={ms[len(ms)//2]} max={ms[-1]}")
        print(f"   under 30min: {sum(1 for m in ms if m<30)}  over 1 day: {sum(1 for m in ms if m>1440)}")

print("\n== DUPLICATE TITLES AMONG ERRORS (regeneration evidence) ==")
tc = collections.Counter((r["title"] or "").strip() for r in rs)
for t, n in tc.most_common():
    if n > 1: print(f"  {n}x  {t[:80]!r}")

print("\n== SAME TITLE ELSEWHERE IN THE TABLE (was it retried successfully?) ==")
allr = pg.rows("carousel_drafts?select=id,title,status,client_id,created_at")
byt = collections.defaultdict(list)
for r in allr: byt[(r["title"] or "").strip()].append(r)
retried = 0
for r in rs:
    sibs = [s for s in byt[(r["title"] or "").strip()] if s["id"] != r["id"]]
    if sibs:
        retried += 1
        print(f"  err {r['id'][:8]} {str(r['title'])[:48]!r} -> siblings: " + ", ".join(f"{s['status']}@{s['created_at'][:10]}" for s in sibs))
print(f"  errored rows that have at least one same-title sibling: {retried}/{len(rs)}")

print("\n== AGENT_LOG shape on a sample of silent rows ==")
for k in ("B_silent_no_message_but_gen_started", "D_silent_no_message_no_marker"):
    for r, *_ in buckets[k][:3]:
        al = r.get("agent_log")
        print(f"  {k} {r['id'][:8]} agent_log={str(al)[:300]!r}")
