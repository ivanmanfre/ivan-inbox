"""Steps 2.4 REPETITION and 2.5 DAILY SHAPE.
Instrument: columns only a human click can write. approved_at on outreach_messages is
set by the inbox approve button; ops_drafts.approved_at and comment_feed.approved_at
likewise. carousel_drafts has no approved_at, so its human signal is updated_at on rows
whose status is an operator-only terminal state."""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
W0, W1 = P("2026-07-23T00:00:00+00:00"), P("2026-08-23T00:00:00+00:00")
enc = lambda s: s.replace("+", "%2B").replace(":", "%3A")

def inwin(t): return t and W0 <= t < W1

print("=== A. HUMAN APPROVE CLICKS: outreach_messages.approved_at ===")
om = pg.rows("outreach_messages?select=id,prospect_id,direction,channel,approved_at,sent_at,created_at,send_blocked_reason,ai_model,message_type&approved_at=not.is.null&order=approved_at.asc")
om = [r for r in om if inwin(P(r["approved_at"]))]
print(f"approvals in window: {len(om)}  (~{len(om)/31:.1f}/day)")

# burst detection: consecutive approvals under 90s apart = one bulk session done one row at a time
ts = sorted(P(r["approved_at"]) for r in om)
bursts, cur = [], [ts[0]] if ts else []
for a, b in zip(ts, ts[1:]):
    if (b - a).total_seconds() <= 90: cur.append(b)
    else: bursts.append(cur); cur = [b]
if cur: bursts.append(cur)
multi = [b for b in bursts if len(b) > 1]
print(f"sessions (gap>90s splits): {len(bursts)}; of those, RUNS of 2+ approvals inside 90s each: {len(multi)}")
print(f"clicks that landed inside a run: {sum(len(b) for b in multi)} of {len(ts)} ({100*sum(len(b) for b in multi)/len(ts):.0f}%)")
sz = collections.Counter(len(b) for b in bursts)
print("run-length histogram:", dict(sorted(sz.items())))
if multi:
    gaps = sorted((b[i+1]-b[i]).total_seconds() for b in multi for i in range(len(b)-1))
    print(f"seconds between consecutive approvals inside a run: min={gaps[0]:.0f} median={gaps[len(gaps)//2]:.0f} p90={gaps[int(len(gaps)*0.9)]:.0f}")
    print("biggest runs:", sorted((len(b), b[0].isoformat()[:16]) for b in multi)[-6:])

print("\n=== B. DAILY SHAPE: approvals by UTC hour ===")
h = collections.Counter(t.hour for t in ts)
for hr in range(24):
    print(f"  {hr:02d}:00 {'#'*h.get(hr,0)}{'' if h.get(hr) else ''} {h.get(hr,0)}")
print("by weekday (Mon=0):", dict(sorted(collections.Counter(t.weekday() for t in ts).items())))
print("by date:", dict(sorted(collections.Counter(t.date().isoformat() for t in ts).items())))
