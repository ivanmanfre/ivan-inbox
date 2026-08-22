"""Step 2.3 DEFINITIVE: cause per errored draft, taken from the last agent_log entry
(the terminal event) and cross-checked against taxonomy.error_message (what the UI shows)."""
import sys, os, collections, re, json, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg

rs = pg.rows("carousel_drafts?select=id,title,client_id,created_at,updated_at,taxonomy,qa,agent_log,post_body&status=eq.error&order=created_at.desc")
now = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))

def terminal(r):
    al = r.get("agent_log")
    if not isinstance(al, list) or not al: return (None, "")
    e = al[-1]
    return (e.get("agent"), e.get("body") or "") if isinstance(e, dict) else (None, str(e))

def attempts(body):
    m = re.search(r"ATTEMPT HISTORY:\s*(\[.*)", body, re.S)
    if not m: return []
    try: return [a.get("outcome") for a in json.loads(m.group(1))]
    except Exception: return []

def cluster(r):
    agent, body = terminal(r)
    tax = r.get("taxonomy") if isinstance(r.get("taxonomy"), dict) else {}
    em = tax.get("error_message") or ""
    if agent == "QA Give-Up" or "QA_BLOCKED" in body:
        outs = attempts(body)
        if outs and all(o == "generation_failed" for o in outs): return "E2_generation_never_returned"
        if outs and any(o == "lint_fail" for o in outs): return "E3_lint_fail_x2"
        return "E1_qa_score_below_floor"
    if agent == "Stuck Sentinel" or "Generation stuck" in body: return "E4_watchdog_true_stall"
    if "_parse_failed" in body or "weekly limit" in body: return "E5_model_quota_leaked_as_content"
    if agent == "Lint Gate" and "PASS" in body: return "E6_terminal_pass_but_status_error"
    return f"E7_other::{agent}"

rowsc = [(r, cluster(r)) for r in rs]
print("=== ERROR CLUSTERS (n=%d, all of status='error' in carousel_drafts) ===" % len(rs))
byc = collections.defaultdict(list)
for r, k in rowsc: byc[k].append(r)
for k, g in sorted(byc.items(), key=lambda kv: -len(kv[1])):
    lanes = collections.Counter(x["client_id"] or "ivan(NULL)" for x in g)
    ages = sorted((now - P(x["created_at"])).days for x in g)
    bodies = sum(1 for x in g if (x.get("post_body") or "").strip())
    print(f"{k:34s} n={len(g):3d} lanes={dict(lanes)} recoverable_body={bodies} med_age={ages[len(ages)//2]}d oldest={ages[-1]}d")

print("\n=== WHAT THE UI PRINTS vs WHAT ACTUALLY HAPPENED ===")
mis = agree = nomsg = 0
for r, k in rowsc:
    tax = r.get("taxonomy") if isinstance(r.get("taxonomy"), dict) else {}
    em = tax.get("error_message") or ""
    if not em: nomsg += 1
    elif "Generation stuck" in em and k != "E4_watchdog_true_stall": mis += 1
    else: agree += 1
print(f"  taxonomy.error_message says 'Generation stuck' but terminal event was NOT the sentinel: {mis}")
print(f"  message agrees with terminal event: {agree}")
print(f"  no taxonomy.error_message at all (card falls back): {nomsg}")

print("\n=== STALL MINUTES CLAIMED BY THE SENTINEL ===")
ms = []
for r, k in rowsc:
    tax = r.get("taxonomy") if isinstance(r.get("taxonomy"), dict) else {}
    m = re.search(r"within (\d+) minutes", tax.get("error_message") or "")
    if m: ms.append(int(m.group(1)))
ms.sort()
print(f"  n={len(ms)} min={ms[0]} median={ms[len(ms)//2]} max={ms[-1]} (max = {ms[-1]/1440:.1f} days)")
