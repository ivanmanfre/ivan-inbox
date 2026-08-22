# READ ONLY. GET requests only. No write verb appears in this file.
import json, os, sys, urllib.request, urllib.parse
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
env = {}
for line in open('/Users/ivanmanfredi/Desktop/ivan-inbox-pw-ai/.env.local'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1); env[k] = v.strip().strip('"')
URL = env['VITE_SUPABASE_URL']; ANON = env['VITE_SUPABASE_ANON_KEY']
TOK = json.load(open('/Users/ivanmanfredi/Desktop/ivan-inbox/.session.json'))['access_token']

def get(path, **params):
    q = urllib.parse.urlencode(params, safe='*.,()')
    req = urllib.request.Request(f'{URL}/rest/v1/{path}?{q}', method='GET')
    req.add_header('apikey', ANON); req.add_header('Authorization', f'Bearer {TOK}')
    req.add_header('Prefer', 'count=exact')
    with urllib.request.urlopen(req) as r:
        return r.headers.get('content-range'), json.loads(r.read())

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'cols':
        for t in ['inbox_messages_v', 'carousel_drafts', 'lm_drafts_v2', 'outreach_prospects']:
            cr, rows = get(t, select='*', limit='1')
            print(f'--- {t} ({cr}) ---')
            print(sorted(rows[0].keys()) if rows else 'empty')
    else:
        cr, rows = get(*sys.argv[2:3], **dict(a.split('=',1) for a in sys.argv[3:]))
        print(cr); print(json.dumps(rows, indent=1)[:3000])
