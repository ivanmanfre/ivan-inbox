#!/usr/bin/env python3
"""Observe Storage response bytes in bounded intervals. Alerts never change application operation."""
import argparse,datetime as dt,fcntl,json,os,pathlib,time,urllib.error,urllib.parse,urllib.request

REF='bjbvqvzbzczjbatgmccb'
API='https://api.supabase.com/v1/projects/'+REF
RELAY='https://n8n.ivanmanfredi.com/webhook/wa-relay?src=supabase-egress'
STEP=900
LAG=300
LOOKBACK=86400
MAX_CATCHUP=4
MAX_ATTEMPTS=192
COOLDOWN={'hour':10800,'day':86400,'sizes':86400,'coverage':86400,'clock':86400,'query_budget':86400}

def iso(value):return dt.datetime.fromtimestamp(value,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
def eligible_end(now):return ((now-LAG)//STEP)*STEP

def logs_url(start,end):
    if type(start) is not int or type(end) is not int or start<0 or start%STEP or end-start!=STEP:
        raise ValueError('Storage queries require one aligned 15-minute interval')
    a,b=iso(start),iso(end)
    sql=("SELECT count() AS requests, sum(toUInt64OrZero(log_attributes['response.headers.content_length'])) AS bytes, "
         "countIf(log_attributes['response.headers.content_length']='') AS unknown_lengths FROM logs "
         "WHERE source='edge_logs' AND log_attributes['request.method']='GET' "
         "AND log_attributes['request.path'] LIKE '/storage/%' "
         "AND timestamp >= parseDateTime64BestEffort('"+a+"') "
         "AND timestamp < parseDateTime64BestEffort('"+b+"')")
    return API+'/analytics/endpoints/logs?'+urllib.parse.urlencode({'sql':sql,'iso_timestamp_start':a,'iso_timestamp_end':b})

def number(value):
    if type(value) is int and value>=0:return value
    if isinstance(value,str) and value.isdigit():return int(value)
    raise ValueError('Invalid Storage aggregate')

def parse_response(value):
    if not isinstance(value,dict) or value.get('error'):raise ValueError('Storage analytics returned an error')
    rows=value.get('result')
    if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict):raise ValueError('Missing Storage aggregate')
    row={k:number(rows[0].get(k)) for k in ('requests','bytes','unknown_lengths')}
    if row['unknown_lengths']>row['requests']:raise ValueError('Invalid size coverage')
    return row

def request_json(request,require_json=True):
    # No automatic retries: a timed-out log query may already have executed.
    with urllib.request.urlopen(request,timeout=20) as response:
        raw=response.read(32769)
        if len(raw)>32768:raise ValueError('Unexpectedly large monitoring response')
        try:body=json.loads(raw) if raw else {}
        except ValueError:
            if require_json:raise
            body={}
        return body,response.status

def fetch_window(token,start,end):
    data,_=request_json(urllib.request.Request(logs_url(start,end),headers={'Authorization':'Bearer '+token,'User-Agent':'ivan-storage-traffic/1'}))
    return parse_response(data)

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix('.tmp')
    with temp.open('w') as stream:
        json.dump(value,stream,sort_keys=True);stream.flush();os.fsync(stream.fileno())
    temp.replace(path)
    directory=os.open(str(path.parent),os.O_RDONLY)
    try:os.fsync(directory)
    finally:os.close(directory)

def load_state(path,end):
    if not path.exists():
        start=max(0,end-3600)
        return {'version':1,'started':start,'cursor':start,'windows':{},'attempts':[],'alerts':{}}
    if path.stat().st_size>1024*1024:raise ValueError('Monitoring state exceeds its expected size')
    value=json.loads(path.read_text())
    if not isinstance(value,dict) or value.get('version')!=1:raise ValueError('Invalid monitoring state')
    for key in ('started','cursor'):
        if type(value.get(key)) is not int or value[key]<0 or value[key]%STEP:raise ValueError('Invalid monitoring cursor')
    if not isinstance(value.get('windows'),dict) or not isinstance(value.get('alerts'),dict) or not isinstance(value.get('attempts'),list):raise ValueError('Invalid monitoring history')
    if any(type(t) is not int or t<0 for t in value['attempts']):raise ValueError('Invalid query history')
    for key,row in value['windows'].items():
        if not key.isdigit() or int(key)%STEP or not isinstance(row,dict) or row.get('status') not in ('ok','pending','error'):raise ValueError('Invalid measured window')
        if row['status']=='ok':parse_response({'result':[row]})
    return value

def collect(state,path,now,fetch):
    end=eligible_end(now)
    state['clock_ahead']=state['cursor']>end
    state['query_budget']=False
    state['attempts']=[t for t in state['attempts'] if t>now-86400]
    state['windows']={k:v for k,v in state['windows'].items() if int(k)>=end-2*LOOKBACK}
    if state['clock_ahead']:save(path,state);return
    if state['cursor']<end-LOOKBACK:
        state['skipped_before']=end-LOOKBACK;state['cursor']=end-LOOKBACK
    for _ in range(MAX_CATCHUP):
        start=state['cursor']
        if start>=end:break
        if len(state['attempts'])>=MAX_ATTEMPTS:state['query_budget']=True;break
        state['attempts'].append(now)
        state['windows'][str(start)]={'status':'pending'}
        state['cursor']=start+STEP
        save(path,state) # Durable reservation precedes the only HTTP attempt for this interval.
        try:state['windows'][str(start)]={'status':'ok',**parse_response({'result':[fetch(start,start+STEP)]})}
        except Exception as exc:state['windows'][str(start)]={'status':'error','error':type(exc).__name__+((':'+str(exc.code)) if isinstance(exc,urllib.error.HTTPError) else '')}
        save(path,state)
    state['checked_at']=now
    save(path,state)

def aggregate(state,end,seconds):
    rows=[r for k,r in state['windows'].items() if end-seconds<=int(k)<end and r['status']=='ok']
    return {k:sum(r[k] for r in rows) for k in ('requests','bytes','unknown_lengths')}|{'covered':len(rows)}

def alert_candidates(state,end):
    hour=aggregate(state,end,3600);day=aggregate(state,end,86400);alerts={}
    if hour['bytes']>1_000_000_000:alerts['hour']='Storage downloads: %.2f GB observed across %d/4 measured intervals in the hour ending %s.'%(hour['bytes']/1e9,hour['covered'],iso(end))
    if day['bytes']>8_000_000_000:alerts['day']='Storage downloads: %.2f GB observed across %d/96 measured intervals in the 24-hour window ending %s.'%(day['bytes']/1e9,day['covered'],iso(end))
    expected=range(max(state['started'],end-LOOKBACK),end,STEP)
    gaps=sum(state['windows'].get(str(t),{}).get('status')!='ok' for t in expected)
    if gaps:alerts['coverage']='Storage monitoring has %d unmeasured intervals; traffic totals are partial.'%gaps
    if day['unknown_lengths']:alerts['sizes']='Storage response sizes were unavailable for %d requests in the measured 24-hour window.'%day['unknown_lengths']
    if state.get('clock_ahead'):alerts['clock']='Storage monitoring clock moved behind its saved cursor; previous intervals will remain saved.'
    if state.get('query_budget'):alerts['query_budget']='Storage monitoring reached its own query-attempt allowance; application processing continues.'
    return alerts

def due_alerts(state,candidates,now):
    due={}
    for kind,text in candidates.items():
        previous=state['alerts'].get(kind)
        if type(previous) is not int or not 0<=now-previous<COOLDOWN[kind]:due[kind]=text
    return due

def credentials(name):
    return (pathlib.Path(os.environ.get('CREDENTIALS_DIRECTORY','/etc/ivan-storage-traffic'))/name).read_text().strip()

def send(config,text):
    if not config.get('key') or not config.get('number'):raise ValueError('Missing own-inbox relay binding')
    req=urllib.request.Request(RELAY,data=json.dumps({'number':config['number'],'text':text}).encode(),headers={'apikey':config['key'],'Content-Type':'application/json'},method='POST')
    result,status=request_json(req,require_json=False)
    if not 200<=status<300 or (isinstance(result,dict) and result.get('ok') is False):raise ValueError('Storage alert was not accepted')

def report_error(directory,config,now,error):
    path=directory/'error-alert.json'
    try:old=json.loads(path.read_text()) if path.exists() else {}
    except (OSError,ValueError):old={}
    last=old.get('at')
    if type(last) is int and 0<=now-last<86400:return
    send(config,'Storage monitoring needs attention: '+error+'. Application processing continues with the provider cap unchanged.')
    save(path,{'at':now,'error':error})

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-id',required=True,choices=['ivan'])
    parser.add_argument('--state-dir',type=pathlib.Path,default=pathlib.Path('/var/lib/ivan-storage-traffic'))
    parser.add_argument('--collect',action='store_true')
    parser.add_argument('--notify',action='store_true')
    args=parser.parse_args();now=int(time.time());end=eligible_end(now);config=None
    args.state_dir.mkdir(parents=True,exist_ok=True)
    with (args.state_dir/'lock').open('w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print(json.dumps({'busy':True}));return 0
        try:
            if args.notify:config=json.loads(credentials('relay-config'))
            path=args.state_dir/'state.json';state=load_state(path,end)
            if args.collect:
                token=credentials('management-token')
                collect(state,path,now,lambda a,b:fetch_window(token,a,b))
            candidates=alert_candidates(state,end);due=due_alerts(state,candidates,now)
            sent=False
            if args.notify and due:
                text='SUPABASE STORAGE TRAFFIC ALERT\n'+'\n'.join(due.values())+'\nApplication processing continues with the provider cap unchanged; byte estimates use Storage response headers.'
                send(config,text)
                for kind in due:state['alerts'][kind]=now
                save(path,state);sent=True
            summary={'checked_at':now,'through':iso(end),'hour':aggregate(state,end,3600),'day':aggregate(state,end,86400),'warnings':list(candidates),'notified':sent,'query_attempts_24h':len(state['attempts'])}
            if args.collect:save(args.state_dir/'last-run.json',summary)
            print(json.dumps(summary));return 0
        except Exception as exc:
            error=type(exc).__name__
            if args.notify and config:
                try:report_error(args.state_dir,config,now,error)
                except Exception:pass
            print(json.dumps({'checked_at':now,'error':error,'application_action':'none'}));return 1

if __name__=='__main__':raise SystemExit(main())
