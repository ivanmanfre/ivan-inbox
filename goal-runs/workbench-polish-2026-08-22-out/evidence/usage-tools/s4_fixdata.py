"""Step 4 inputs: how much of the error-reason repair is reachable from columns the
list already selects (content.ts COLS), and what the big batch writes actually were."""
import sys, os, collections, re, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg

rs = pg.rows("carousel_drafts?select=id,status,client_id,taxonomy,qa,agent_log,post_body&status=eq.error")
def em(r):
    t = r.get("taxonomy") if isinstance(r.get("taxonomy"), dict) else {}
    return t.get("error_message")
def qv(r):
    q = r.get("qa") if isinstance(r.get("qa"), dict) else {}
    return q.get("verdict"), q.get("score"), q.get("qa_regen_attempts")
def term(r):
    al = r.get("agent_log")
    return al[-1].get("agent") if isinstance(al, list) and al and isinstance(al[-1], dict) else None

print("=== can the CARD tell the truth from columns it already selects? ===")
print("COLS already carries qa_verdict (qa->>verdict) and qa_score (qa->>score) — content.ts:87-91")
sen = [r for r in rs if em(r) and "Generation stuck" in em(r)]
nomsg = [r for r in rs if not em(r)]
print(f"rows printing the sentinel sentence: {len(sen)}")
print(f"  ... of which carry a qa.verdict already in COLS: {sum(1 for r in sen if qv(r)[0])}")
print(f"  ... of which the terminal agent was NOT the sentinel: {sum(1 for r in sen if term(r) != 'Stuck Sentinel')}")
print(f"rows printing the 'No reason recorded' fallback: {len(nomsg)}")
print(f"  ... of which carry a qa.verdict already in COLS: {sum(1 for r in nomsg if qv(r)[0])}")
print(f"  ... of which carry NEITHER message nor verdict: {sum(1 for r in nomsg if not qv(r)[0])}")
print("verdict values on errored rows:", collections.Counter(qv(r)[0] for r in rs).most_common())
print("errored rows holding a non-empty post_body:", sum(1 for r in rs if (r.get('post_body') or '').strip()), "of", len(rs))

print("\n=== the batch writes: what were they? ===")
allr = pg.rows("carousel_drafts?select=id,status,client_id,updated_at,board_visible,taxonomy")
c = collections.Counter(r["updated_at"] for r in allr)
for ts, n in [x for x in c.most_common(6) if x[1] > 5]:
    g = [r for r in allr if r["updated_at"] == ts]
    print(f"{ts}  n={n}  lanes={dict(collections.Counter(r['client_id'] or 'ivan' for r in g))} "
          f"statuses={dict(collections.Counter(r['status'] for r in g))} "
          f"board_visible={dict(collections.Counter(str(r['board_visible']) for r in g))}")

print("\n=== reversal demand: is there any evidence he undoes decisions? ===")
print("rows carrying taxonomy.deleted_by_operator:",
      sum(1 for r in allr if isinstance(r.get("taxonomy"), dict) and r["taxonomy"].get("deleted_by_operator")))
om = pg.rows("outreach_messages?select=id,send_blocked_reason,send_blocked_at,approved_at,sent_at")
print("DM rows in the exact shape restoreDraft targets (discarded_in_inbox, unapproved, unsent):",
      sum(1 for r in om if r.get("send_blocked_reason") == "discarded_in_inbox" and not r.get("approved_at") and not r.get("sent_at")))
print("discarded rows that were LATER approved (i.e. a discard was reversed):",
      sum(1 for r in om if r.get("send_blocked_reason") == "discarded_in_inbox" and r.get("approved_at")))

print("\n=== client-lane bulk caps: what a selection of client review rows can do ===")
print("reviewActionable(status, lane) = (review|error) AND lane=='ivan'   [content.ts:1435]")
cl = [r for r in allr if r["status"] == "review" and r["client_id"] in ("risedtc", "arch")]
onboard = sum(1 for r in cl if r.get("board_visible") is True)
print(f"client review rows: {len(cl)}; already on a client board: {onboard}; "
      f"so caps=['delete'] on {len(cl)-onboard} of them and caps=[] on {onboard}")
