"""Step 2.3 final: real cause from the LAST agent_log entry on every errored draft."""
import sys, os, collections, re, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg

rs = pg.rows("carousel_drafts?select=id,title,client_id,created_at,updated_at,taxonomy,qa,agent_log,post_body&status=eq.error&order=created_at.desc")
now = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))

def last_log(r):
    al = r.get("agent_log")
    if not isinstance(al, list) or not al: return None, None
    e = al[-1]
    if not isinstance(e, dict): return None, str(e)[:200]
    return e.get("agent"), (e.get("body") or "")[:300]

def cause(r):
    tax = r.get("taxonomy") if isinstance(r.get("taxonomy"), dict) else {}
    em = tax.get("error_message") or ""
    agent, body = last_log(r)
    if "VERDICT: FAIL" in (body or ""): return "QA_FAIL_after_regens"
    if "Generation stuck" in em:
        m = int(re.search(r"within (\d+) minutes", em).group(1))
        return "WATCHDOG_stall_over_1day" if m > 1440 else "WATCHDOG_stall_minutes"
    if body and "lint" in body.lower(): return "LINT"
    if agent is None and not em: return "SILENT_no_log_no_message"
    return f"OTHER::{agent}"

c = collections.Counter()
detail = collections.defaultdict(list)
for r in rs:
    k = cause(r); c[k] += 1; detail[k].append(r)

print("== CAUSE CLUSTERS (from taxonomy.error_message + last agent_log entry) ==")
for k, n in c.most_common():
    g = detail[k]
    lanes = collections.Counter(x["client_id"] or "ivan(NULL)" for x in g)
    bodies = sum(1 for x in g if (x.get("post_body") or "").strip())
    ages = sorted((now - P(x["created_at"])).days for x in g)
    print(f"{k:28s} n={n:3d} lanes={dict(lanes)} has_post_body={bodies} med_age={ages[len(ages)//2]}d oldest={ages[-1]}d")

print("\n== ALL DISTINCT LAST-LOG AGENTS ON ERROR ROWS ==")
print(collections.Counter(last_log(r)[0] for r in rs).most_common())

print("\n== FULL LAST-LOG BODY SAMPLES per cluster ==")
for k, g in detail.items():
    print(f"\n--- {k} ---")
    for r in g[:2]:
        a, b = last_log(r)
        print(f"  {r['id'][:8]} [{a}] {b!r}")

print("\n== QA verdict field on error rows ==")
qv = collections.Counter()
for r in rs:
    q = r.get("qa") if isinstance(r.get("qa"), dict) else {}
    qv[(q.get("verdict"), q.get("qa_regen_attempts"))] += 1
print(qv.most_common(12))
