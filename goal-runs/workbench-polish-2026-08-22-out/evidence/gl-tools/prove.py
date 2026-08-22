#!/usr/bin/env python3
"""Every number the glance layer renders, re-derived INDEPENDENTLY.

The app reaches PostgREST through supabase-js. This reaches it with curl, from a
separate process, writing each predicate out by hand rather than importing the
app's query builder, so a bug in the builder cannot make both sides agree.
Every request is a GET. Attempted writes: 0.

Usage: source evidence/usage-tools/env.sh && python3 prove.py <verify.json>
"""
import json, os, subprocess, sys, datetime

URL, ANON, TOK = os.environ['URL'], os.environ['ANON'], os.environ['TOK']
H = ['-H', 'apikey: ' + ANON, '-H', 'Authorization: Bearer ' + TOK]

def rows(path):
    r = subprocess.run(['curl', '-s', f'{URL}/rest/v1/{path}'] + H, capture_output=True, text=True)
    return json.loads(r.stdout)

def count(path):
    """Prefer: count=exact with Range 0-0, so no row body is pulled at all.
    This is the shape that survives the 1000-row select clamp."""
    r = subprocess.run(
        ['curl', '-s', '-D', '-', '-o', '/dev/null', f'{URL}/rest/v1/{path}'] + H
        + ['-H', 'Prefer: count=exact', '-H', 'Range: 0-0'],
        capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.lower().startswith('content-range:'):
            return int(line.split('/')[-1].strip())
    raise SystemExit('no content-range for ' + path)

CUT = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=14)).isoformat()
v = json.load(open(sys.argv[1]))
r = v['rendered']
checks = []

def chk(name, rendered, truth, predicate):
    checks.append({'name': name, 'rendered': rendered, 'independent': truth,
                   'agree': rendered == truth, 'predicate': predicate})

# 1 - the Content rail row
chk('rail Content', r['rail']['Content'],
    count('carousel_drafts?select=id&status=eq.review'),
    "carousel_drafts status=eq.review, NO lane filter")

# 2 - the three lane pills, and that they sum to the rail row
for lane, col in (('Ivan', 'client_id=is.null'),
                  ('Mattan Danino', 'client_id=eq.risedtc'),
                  ('Davorin Smit', 'client_id=eq.arch')):
    chk(f'lane pill {lane}', r['lanes'][lane],
        count(f'carousel_drafts?select=id&status=eq.review&{col}'),
        f"carousel_drafts status=eq.review AND {col}")
chk('lane pills sum to the rail row',
    sum(r['lanes'][k] for k in ('Ivan', 'Mattan Danino', 'Davorin Smit')),
    r['rail']['Content'], 'internal consistency, not a database read')

# 3 - Magnets
chk('rail Magnets', r['rail']['Magnets'],
    count('lm_drafts_v2?select=id&status=in.(review,lm_review)'),
    "lm_drafts_v2 status in (review, lm_review), NO lane filter")

# 4 - the roll-up is exactly the rail's own counts
chk('roll-up = sum of rail counts', r['rollup'],
    sum(n for k, n in r['rail'].items() if k != 'Workflows'),
    'the rail rows on screen, added up. Workflows is excluded by design.')

# 5 - the automation alarm, rebuilt from both views and deduped by name
wf = rows('dashboard_workflow_stats?select=workflow_name,last_execution_at'
          '&last_execution_status=eq.error&is_active=is.true')
so = rows('scheduled_ops_status?select=label,last_run_at&enabled=is.true'
          '&status=in.(OVERDUE,ERRORING)')
red = {w['workflow_name'].strip().lower() for w in wf
       if w['last_execution_at'] and w['last_execution_at'] > CUT}
stalled = {s['label'].strip().lower() for s in so
           if s['last_run_at'] and s['last_run_at'] > CUT}
chk('rail Workflows', r['rail']['Workflows'], len(red | stalled),
    'union, deduped on trimmed lowercase name, of: '
    'dashboard_workflow_stats(last_execution_status=error, is_active, last_execution_at within 14d) '
    'and scheduled_ops_status(enabled, status in OVERDUE/ERRORING, last_run_at within 14d)')
chk('Ops list length', v['ops']['n'], len(red | stalled), 'same set, rendered as rows')
chk('the two health views really do overlap', len(red & stalled), 6,
    'the 6 n8n-sourced jobs both views describe. A naive sum would claim '
    f'{len(red) + len(stalled)} broken automations instead of {len(red | stalled)}.')

# 6 - what the window excludes, stated on screen as "N more"
older = (count('dashboard_workflow_stats?select=id&last_execution_status=eq.error&is_active=is.true')
         - len(red)) + (count('scheduled_ops_status?select=id&enabled=is.true'
                              '&status=in.(OVERDUE,ERRORING)') - len(stalled))
chk('"N more" outside the window', int(v['ops']['tail'].split()[0]), older,
    'rows in both views that are red or overdue but last ran over 14 days ago')

# 7 - the stage tabs are a DIFFERENT scope on purpose. Proven, not assumed:
#     the Needs review tab is Ivan's lane alone.
chk('Needs review tab is lane-scoped', r['tabs']['Needs review'],
    count('carousel_drafts?select=id&status=eq.review&client_id=is.null'),
    'the tab counts the selected lane; the rail row counts every lane. '
    'Both are on screen at once and the lane pills show the arithmetic.')

bad = [c for c in checks if not c['agree']]
print(json.dumps({'now': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'window_cut': CUT, 'checks': checks,
                  'disagreements': len(bad)}, indent=1))
sys.exit(1 if bad else 0)
