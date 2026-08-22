import sys, os, json, re
sys.path.insert(0,'/Users/ivanmanfredi/Desktop/ivan-inbox/goal-runs/workbench-polish-2026-08-22-out/evidence/usage-tools')
import pg
rs = pg.rows("carousel_drafts?select=id,title,client_id,created_at,updated_at,taxonomy,agent_log,post_body,slides,image_urls,qa&status=eq.error")
for r in rs:
    al=r.get("agent_log")
    if isinstance(al,list) and al and isinstance(al[-1],dict) and al[-1].get("agent")=="Lint Gate" and "PASS" in (al[-1].get("body") or ""):
        print("="*80)
        print(r["id"][:8], r["client_id"], r["created_at"][:16], "updated", r["updated_at"][:16], "body_len", len(r.get("post_body") or ""), "slides", bool(r.get("slides")), "imgs", len(r.get("image_urls") or []))
        for e in al: print("   ", e.get("ts"), "|", e.get("agent"), "|", (e.get("body") or "")[:110].replace("\n"," "))
        print("   taxonomy:", json.dumps(r.get("taxonomy"))[:200])
