"""Step 2.4 REPETITION on content kills.
A shared updated_at to the microsecond is ONE sql statement (a batch job), not N clicks.
Only DISTINCT instants can be human actions, so cluster those."""
import sys, os, collections, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg
P = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
W0, W1 = P("2026-07-23T00:00:00+00:00"), P("2026-08-23T00:00:00+00:00")

cd = pg.rows("carousel_drafts?select=id,status,client_id,title,created_at,updated_at&order=updated_at.asc")
inw = [r for r in cd if W0 <= P(r["updated_at"]) < W1]
c = collections.Counter(r["updated_at"] for r in inw)
batch = {k: v for k, v in c.items() if v > 1}
print(f"carousel_drafts rows updated in window: {len(inw)}")
print(f"  distinct updated_at instants: {len(c)}")
print(f"  instants shared by 2+ rows (ONE sql statement each): {len(batch)}, covering {sum(batch.values())} rows")
print(f"  biggest batch writes: {sorted(batch.items(), key=lambda kv: -kv[1])[:6]}")
solo = sorted(P(k) for k, v in c.items() if v == 1)
print(f"  single-row writes (candidate human actions): {len(solo)}")

def runs(ts, gap):
    out, cur = [], [ts[0]]
    for a, b in zip(ts, ts[1:]):
        if (b - a).total_seconds() <= gap: cur.append(b)
        else: out.append(cur); cur = [b]
    out.append(cur); return out

for gap, label in ((3, "3s (a loop inside one click)"), (90, "90s (one human working a list)")):
    r = runs(solo, gap); multi = [b for b in r if len(b) > 1]
    inr = sum(len(b) for b in multi)
    print(f"\n  clustered at gap<= {label}: {len(r)} clusters, {len(multi)} of size 2+, {inr} writes inside a cluster ({100*inr/len(solo):.0f}%)")
    print(f"    cluster sizes: {dict(sorted(collections.Counter(len(b) for b in r).items()))}")
    if multi:
        g = sorted((b[i+1]-b[i]).total_seconds() for b in multi for i in range(len(b)-1))
        print(f"    gap inside a cluster: min={g[0]:.2f}s median={g[len(g)//2]:.2f}s p90={g[int(len(g)*.9)]:.2f}s")
        print(f"    biggest: {sorted((len(b), b[0].isoformat()[:19]) for b in multi)[-8:]}")

print("\n=== per-write spacing histogram on single-row writes (bucketed) ===")
gaps = [(b - a).total_seconds() for a, b in zip(solo, solo[1:])]
buck = collections.Counter()
for g in gaps:
    if g < 0.5: buck["<0.5s"] += 1
    elif g < 3: buck["0.5-3s"] += 1
    elif g < 30: buck["3-30s"] += 1
    elif g < 300: buck["30s-5m"] += 1
    elif g < 3600: buck["5-60m"] += 1
    else: buck[">1h"] += 1
print(" ", dict(buck))
