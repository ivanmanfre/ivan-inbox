"""Steps 2.4/2.5 with instruments that ONLY this app writes.
 - outreach_messages.read_at        <- markThreadRead, inbox.ts:855, fires on every thread open
 - outreach_messages.send_blocked_at with reason 'discarded_in_inbox' <- discardDraft, inbox.ts:764
 - outreach_messages.snoozed_at     <- snoozeDraft, inbox.ts:687
 - outreach_messages.approved_at with lag>120s over created_at  <- a human approve, not the cron
   (709 of 814 approvals land <60s after row creation: that is the auto-sender, /tmp/dedupe.py)
"""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
W0, W1 = P("2026-07-23T00:00:00+00:00"), P("2026-08-23T00:00:00+00:00")

def runs(stamps, gap=90):
    ts = sorted(stamps)
    if not ts: return []
    out, cur = [], [ts[0]]
    for a, b in zip(ts, ts[1:]):
        if (b - a).total_seconds() <= gap:
            cur.append(b)
        else:
            out.append(cur); cur = [b]
    out.append(cur); return out

def report(name, stamps):
    ts = sorted(stamps)
    if not ts: print(f"\n### {name}: 0 events"); return
    r = runs(ts); multi = [b for b in r if len(b) > 1]
    inruns = sum(len(b) for b in multi)
    print(f"\n### {name}")
    print(f"  events in window: {len(ts)}  ({len(ts)/31:.1f}/day)  active days: {len(set(t.date() for t in ts))}/31")
    print(f"  sessions (gap>90s): {len(r)}   runs of 2+: {len(multi)}   events inside a run: {inruns} ({100*inruns/len(ts):.0f}%)")
    print(f"  run-length histogram: {dict(sorted(collections.Counter(len(b) for b in r).items()))}")
    if multi:
        g = sorted((b[i+1]-b[i]).total_seconds() for b in multi for i in range(len(b)-1))
        print(f"  seconds between events inside a run: min={g[0]:.0f} median={g[len(g)//2]:.0f} p90={g[int(len(g)*.9)]:.0f}")
        print(f"  longest runs: {sorted((len(b), b[0].isoformat()[:16]) for b in multi)[-5:]}")
    h = collections.Counter(t.hour for t in ts)
    print("  by UTC hour: " + " ".join(f"{k:02d}h={v}" for k, v in sorted(h.items())))
    print("  by weekday Mon0: " + str(dict(sorted(collections.Counter(t.weekday() for t in ts).items()))))

om = pg.rows("outreach_messages?select=id,prospect_id,direction,channel,approved_at,sent_at,created_at,read_at,snoozed_at,send_blocked_at,send_blocked_reason,message_type,ai_model")
inw = lambda s: s and W0 <= P(s) < W1

# read_at is stamped on EVERY inbound row of the thread in one UPDATE, so distinct
# instants, not rows, count the opens (inbox.ts:855).
report("THREAD OPENS (distinct read_at instants)", sorted({P(r["read_at"]) for r in om if inw(r.get("read_at"))}))
report("HUMAN APPROVES (approved_at, lag>120s after created_at)",
       [P(r["approved_at"]) for r in om if inw(r.get("approved_at")) and (P(r["approved_at"]) - P(r["created_at"])).total_seconds() > 120])
report("CRON APPROVES (lag<=120s)",
       [P(r["approved_at"]) for r in om if inw(r.get("approved_at")) and (P(r["approved_at"]) - P(r["created_at"])).total_seconds() <= 120])
report("DISCARDS (discarded_in_inbox)",
       [P(r["send_blocked_at"]) for r in om if inw(r.get("send_blocked_at")) and r.get("send_blocked_reason") == "discarded_in_inbox"])
report("SNOOZES (snoozed_at)", [P(r["snoozed_at"]) for r in om if inw(r.get("snoozed_at"))])
# composeReply stamps message_type='manual_reply' (inbox.ts:843). `ai_model IS NULL`
# alone is NOT the hand-typed set: 932 of those rows are automated connection_note.
report("HAND-TYPED REPLIES (message_type='manual_reply')",
       [P(r["created_at"]) for r in om if inw(r.get("created_at")) and r.get("message_type") == "manual_reply"])

print("\n### send_blocked_reason distribution, all time")
print(collections.Counter(r.get("send_blocked_reason") for r in om if r.get("send_blocked_reason")).most_common(20))
