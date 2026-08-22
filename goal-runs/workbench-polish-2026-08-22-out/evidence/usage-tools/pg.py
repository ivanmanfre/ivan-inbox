"""Read-only PostgREST helper. GET only, ever. Pages past the 1000-row clamp."""
import json, os, subprocess, urllib.parse, urllib.request

ROOT = "/Users/ivanmanfredi/Desktop/ivan-inbox"

def _env():
    url = anon = None
    for line in open(os.path.join(ROOT, ".env.local")):
        if line.startswith("VITE_SUPABASE_URL="): url = line.split("=", 1)[1].strip()
        if line.startswith("VITE_SUPABASE_ANON_KEY="): anon = line.split("=", 1)[1].strip()
    tok = json.load(open(os.path.join(ROOT, ".session.json")))["access_token"]
    return url, anon, tok

URL, ANON, TOK = _env()

def _req(path, extra_headers=None):
    r = urllib.request.Request(f"{URL}/rest/v1/{path}")
    r.add_header("apikey", ANON)
    r.add_header("Authorization", f"Bearer {TOK}")
    for k, v in (extra_headers or {}).items():
        r.add_header(k, v)
    return r

def count(path):
    """Exact row count via Prefer: count=exact + a zero-width Range."""
    r = _req(path, {"Prefer": "count=exact", "Range": "0-0", "Range-Unit": "items"})
    with urllib.request.urlopen(r) as resp:
        cr = resp.headers.get("Content-Range", "")
    return int(cr.split("/")[-1])

def rows(path, page=1000, cap=200000):
    """Fetch every row, paging with Range headers (a SELECT clamps at 1000)."""
    out, off = [], 0
    while off < cap:
        r = _req(path, {"Range": f"{off}-{off+page-1}", "Range-Unit": "items"})
        with urllib.request.urlopen(r) as resp:
            batch = json.load(resp)
        out.extend(batch)
        if len(batch) < page: break
        off += page
    return out
