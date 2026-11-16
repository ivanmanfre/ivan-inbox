#!/usr/bin/env python3
"""Check installed quota protections using local state only; never scans Supabase logs."""
import argparse,hashlib,importlib.util,json,math,os,pathlib,re,subprocess,time

STATE=pathlib.Path.home()/'.local/state/library-thumbnails'
WATCHER=pathlib.Path.home()/'.claude/lib/supabase-storage-egress-watch.py'

def issues(snapshot,now):
    problems=[];run=snapshot.get('last_run',{});stamp=run.get('completed_at')
    if type(stamp) not in (int,float) or not math.isfinite(stamp) or not 0<=now-stamp<=36*3600:
        problems.append('Preview refresh has no recent verified completion')
    if run.get('errors'):problems.append('Preview refresh reported errors')
    if run.get('budget_stop'):problems.append('Preview download budget stopped the job')
    if snapshot.get('budget',{}).get('blocked'):problems.append('Preview freshness circuit is open')
    if not snapshot.get('job_loaded'):problems.append('Preview launchd job is unloaded')
    elif snapshot.get('job_exit')!=0:problems.append('Preview launchd job failed')
    if not snapshot.get('poller_disabled'):problems.append('Expensive Storage log poller is enabled')
    if not snapshot.get('files_match'):problems.append('Installed quota protection files differ from the verified install')
    return problems

def should_notify(previous,problems,now):
    stamp=previous.get('last_alert_at',0)
    recent=type(stamp) in (int,float) and math.isfinite(stamp) and 0<=now-stamp<86400
    return bool(problems) and (previous.get('problems')!=problems or not recent)

def read_json(path):
    try:
        value=json.loads(path.read_text())
        return value if isinstance(value,dict) else {}
    except (OSError,ValueError):return {}

def snapshot():
    domain=f'gui/{os.getuid()}'
    job=subprocess.run(['launchctl','print',domain+'/com.ivan.library-thumbnails'],capture_output=True,text=True)
    disabled=subprocess.run(['launchctl','print-disabled',domain],capture_output=True,text=True)
    match=re.search(r'last exit code = (\d+)',job.stdout)
    manifest=read_json(STATE/'installed.json');hashes=manifest.get('sha256',{})
    if not isinstance(hashes,dict):hashes={}
    files_match=bool(hashes)
    for path,digest in hashes.items():
        try:files_match=files_match and hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()==digest
        except OSError:files_match=False
    return {'last_run':read_json(STATE/'last-run.json'),'budget':read_json(STATE/'budget.json'),
            'job_loaded':job.returncode==0,'job_exit':int(match[1]) if match else None,
            'poller_disabled':disabled.returncode==0 and '"com.ivan.supabase-storage-egress-watch" => disabled' in disabled.stdout,
            'files_match':files_match}

def notify(text):
    spec=importlib.util.spec_from_file_location('watch',WATCHER)
    watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch)
    return watch.send(watch.token(),text) # Existing own-inbox route; two keyed config reads, no log API.

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-id',required=True,choices=['ivan'])
    parser.add_argument('--notify',action='store_true')
    args=parser.parse_args();now=time.time()
    problems=issues(snapshot(),now);previous=read_json(STATE/'guard-last-run.json')
    result={'checked_at':now,'problems':problems,'last_alert_at':previous.get('last_alert_at',0),'notified':False}
    if args.notify and should_notify(previous,problems,now):
        status=notify('SUPABASE USAGE PROTECTION NEEDS ATTENTION\n'+'\n'.join(problems)
                      +'\nThe protection check used local state. It did not scan Supabase logs. The spend cap has not been changed.')
        if status!=200:raise RuntimeError('Quota protection notification was not accepted')
        result.update(last_alert_at=now,notified=True)
    if args.notify:
        STATE.mkdir(parents=True,exist_ok=True)
        temp=STATE/'guard-last-run.tmp';temp.write_text(json.dumps(result,indent=2));temp.replace(STATE/'guard-last-run.json')
    print(json.dumps(result))
    return int(bool(problems))

if __name__=='__main__':raise SystemExit(main())
