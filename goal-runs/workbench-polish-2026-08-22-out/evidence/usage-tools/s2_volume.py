"""Step 2.1 VOLUME + 2.2 FUNNEL. Window 2026-07-23 .. 2026-08-22 UTC."""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg

W0 = "2026-07-23T00:00:00+00:00"
W1 = "2026-08-23T00:00:00+00:00"
enc = lambda s: s.replace("+", "%2B").replace(":", "%3A")

def hdr(t): print("\n" + "=" * 70 + "\n" + t + "\n" + "=" * 70)

hdr("TOTAL ROWS PER TABLE (all time) and IN WINDOW")
specs = [
    ("carousel_drafts", "created_at", "updated_at"),
    ("outreach_messages", "created_at", None),
    ("lm_idea_candidates", "created_at", None),
    ("ops_drafts", "created_at", None),
    ("scheduled_posts", "created_at", "updated_at"),
    ("client_ideas", "created_at", None),
    ("comment_feed", "created_at", None),
    ("outreach_prospects", "created_at", "updated_at"),
    ("scans", "created_at", None),
]
for t, cc, uc in specs:
    tot = pg.count(f"{t}?select=id")
    created = pg.count(f"{t}?select=id&{cc}=gte.{enc(W0)}&{cc}=lt.{enc(W1)}")
    line = f"{t:22s} all={tot:7d}  created_in_window={created:6d}"
    if uc:
        upd = pg.count(f"{t}?select=id&{uc}=gte.{enc(W0)}&{uc}=lt.{enc(W1)}")
        line += f"  updated_in_window={upd:6d}"
    print(line)

hdr("carousel_drafts STATUS DISTRIBUTION (all live rows) + median age")
rs = pg.rows("carousel_drafts?select=id,status,created_at,updated_at,scheduled_at,published_at,client_id,board_visible,type")
now = dt.datetime(2026, 8, 22, 12, 0, tzinfo=dt.timezone.utc)
def parse(s):
    if not s: return None
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
by = collections.defaultdict(list)
for r in rs: by[r["status"]].append(r)
print(f"{'status':22s} {'n':>5s} {'med_age_d':>10s} {'oldest_d':>9s} {'med_since_upd_d':>16s}")
for st, g in sorted(by.items(), key=lambda kv: -len(kv[1])):
    ages = sorted((now - parse(r["created_at"])).days for r in g if r["created_at"])
    upd = sorted((now - parse(r["updated_at"])).days for r in g if r["updated_at"])
    med = ages[len(ages)//2] if ages else -1
    old = ages[-1] if ages else -1
    mu = upd[len(upd)//2] if upd else -1
    print(f"{str(st):22s} {len(g):5d} {med:10d} {old:9d} {mu:16d}")

hdr("carousel_drafts STATUS x client_id")
cc = collections.Counter((r["status"], r["client_id"]) for r in rs)
for (st, cl), n in sorted(cc.items(), key=lambda kv: -kv[1])[:25]:
    print(f"{str(st):22s} {str(cl):10s} {n:5d}")
