#!/usr/bin/env python3
"""Build reusable previews from public originals. Explicit client scope; dry by default."""
import argparse, base64, concurrent.futures, fcntl, importlib.util, io, json, os
import math, pathlib, time, urllib.error, urllib.parse, urllib.request, warnings
from PIL import Image, ImageOps, UnidentifiedImageError

HOST='https://bjbvqvzbzczjbatgmccb.supabase.co'
PREFIX='_library-thumbnails/w480-h600-q75/'
MAX_SOURCE=16*1024*1024
DAILY_SOURCE_BUDGET=512*1024*1024
Image.MAX_IMAGE_PIXELS=60_000_000

class InvalidSourceImage(ValueError):
    pass

def save_json(path,value):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,indent=2));temp.replace(path)

def load_budget(path,now):
    value=json.loads(path.read_text()) if path.exists() else {'reservations':[]}
    if not isinstance(value,dict) or not isinstance(value.get('reservations'),list):
        raise ValueError('Invalid preview budget; refusing downloads')
    for item in value['reservations']:
        if (not isinstance(item,dict) or type(item.get('bytes')) is not int or item['bytes']<0
            or type(item.get('at')) not in (int,float) or not math.isfinite(item['at'])
            or item['at']>now+300):raise ValueError('Invalid preview reservation; refusing downloads')
    value['reservations']=[r for r in value['reservations'] if r['at']>now-86400]
    return value

def reserve_batch(path,budget,rows):
    amount=sum((int(r['bytes']) if int(r['bytes'])>0 else MAX_SOURCE)+1 for r in rows)
    if sum(r['bytes'] for r in budget['reservations'])+amount>DAILY_SOURCE_BUDGET:return False
    budget['reservations'].append({'at':time.time(),'bytes':amount})
    save_json(path,budget) # Charge before any GET, including failed or interrupted downloads.
    return True

def verify_created(w,token,rows):
    if not rows:return True
    expected=json.dumps([{k:r[k] for k in ('bucket_id','name','etag','source_updated_at')} for r in rows]).replace("'","''")
    result=w.sql(token,"""select count(*) as mismatches from jsonb_to_recordset('"""+expected+"""'::jsonb)
      as expected(bucket_id text,name text,etag text,source_updated_at text)
      left join storage.objects p on p.bucket_id=expected.bucket_id
        and p.name='_library-thumbnails/w480-h600-q75/'||expected.name||'.webp'
      where p.id is null or p.user_metadata->>'source_updated_at' is distinct from expected.source_updated_at
        or p.user_metadata->>'source_etag' is distinct from expected.etag""")
    return len(result)==1 and int(result[0]['mismatches'])==0

def thumbnail_path(path):
    if not path or path.startswith('_library-thumbnails/') or any(p in ('','..','.') for p in path.split('/')):
        raise ValueError('Invalid original image path')
    return PREFIX+path+'.webp'

def make_thumbnail(raw):
    if len(raw)>MAX_SOURCE:raise ValueError('Original exceeds the preview input limit')
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as source:
            source.seek(0)
            image=ImageOps.exif_transpose(source).convert('RGBA')
            image.thumbnail((480,600),Image.Resampling.LANCZOS)
            output=io.BytesIO()
            image.save(output,format='WEBP',quality=75,method=4)
            return output.getvalue()

def bindings():
    spec=importlib.util.spec_from_file_location('watch','/Users/ivanmanfredi/.claude/lib/supabase-storage-egress-watch.py')
    w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
    token=w.token()
    key=w.sql(token,"select value from integration_config where key='n8n_sb_key'")[0]['value']
    if key.startswith('"'):key=json.loads(key)
    return w,token,key

def pending(w,token,limit,failed=None):
    excluded=[]
    for key,version in (failed or {}).items():
        bucket,_,name=key.partition('/')
        excluded.append(dict(bucket_id=bucket,name=name,etag=version.get('etag'),
                             source_updated_at=version.get('source_updated_at')))
    bad_json=json.dumps(excluded).replace("'","''")
    return w.sql(token,"""select o.bucket_id,o.name,o.updated_at::text as source_updated_at,
      o.metadata->>'eTag' as etag,coalesce((o.metadata->>'size')::bigint,0) as bytes
      from storage.objects o join storage.buckets b on b.id=o.bucket_id and b.public
      left join storage.objects p on p.bucket_id=o.bucket_id
        and p.name='_library-thumbnails/w480-h600-q75/'||o.name||'.webp'
      where o.bucket_id in ('post-stills','client-photos')
        and left(o.name,20)<>'_library-thumbnails/'
        and o.name ~* '\\.(jpe?g|png|webp|gif|avif)$'
        and coalesce((o.metadata->>'size')::bigint,0)<=16777216
        and not (string_to_array(o.name,'/') && array['onepost','_edit_preview'])
        and not exists(select 1 from jsonb_to_recordset('"""+bad_json+"""'::jsonb)
          as bad(bucket_id text,name text,etag text,source_updated_at text)
          where bad.bucket_id=o.bucket_id and bad.name=o.name
            and bad.etag is not distinct from o.metadata->>'eTag'
            and bad.source_updated_at=o.updated_at::text)
        and (p.id is null or p.user_metadata->>'source_updated_at' is distinct from o.updated_at::text
             or p.user_metadata->>'source_etag' is distinct from o.metadata->>'eTag')
      order by o.bucket_id,o.name limit """+str(limit))

def create_one(row,key):
    assert row['bucket_id'] in ('post-stills','client-photos')
    try:target=thumbnail_path(row['name'])
    except ValueError as exc:raise InvalidSourceImage(str(exc)) from exc
    quote=lambda path:urllib.parse.quote(path,safe='/')
    source=HOST+'/storage/v1/object/public/'+row['bucket_id']+'/'+quote(row['name'])
    headers={}
    if row['etag']:headers['If-Match']='"'+row['etag'].strip('"')+'"'
    allowed=min(MAX_SOURCE,int(row['bytes'])) if int(row['bytes'])>0 else MAX_SOURCE
    with urllib.request.urlopen(urllib.request.Request(source,headers=headers),timeout=45) as response:
        raw=response.read(allowed+1)
    if len(raw)>allowed:raise InvalidSourceImage('Original exceeds the reserved preview input limit')
    try:preview=make_thumbnail(raw)
    except (UnidentifiedImageError,Image.DecompressionBombError,Image.DecompressionBombWarning,OSError,ValueError) as exc:
        raise InvalidSourceImage(type(exc).__name__) from exc
    metadata={'source_updated_at':row['source_updated_at'],'source_etag':row['etag']}
    headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'image/webp',
             'Cache-Control':'max-age=300','x-upsert':'true',
             'x-metadata':base64.b64encode(json.dumps(metadata).encode()).decode()}
    req=urllib.request.Request(HOST+'/storage/v1/object/'+row['bucket_id']+'/'+quote(target),
        data=preview,headers=headers,method='POST')
    with urllib.request.urlopen(req,timeout=45) as response:
        if response.status not in (200,201):raise RuntimeError('Preview upload rejected')
        response.read()
    return {'source_bytes':len(raw),'preview_bytes':len(preview)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-id',required=True,choices=['ivan'],help='Credential owner; covers both public library buckets across all tenants')
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--limit',type=int,default=1000)
    args=parser.parse_args()
    if not 1<=args.limit<=1000:parser.error('limit must be 1..1000')
    state=pathlib.Path.home()/'.local/state/library-thumbnails'
    state.mkdir(parents=True,exist_ok=True)
    with open(state/'lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print('Another preview run is active');return 0
        budget_path=state/'budget.json';budget=load_budget(budget_path,time.time())
        if args.apply and budget.get('blocked'):
            summary={'apply':True,'errors':1,'freshness_blocked':True,'completed_at':time.time()}
            save_json(state/'last-run.json',summary);print(json.dumps(summary));return 1
        failed_path=state/'failed.json'
        failed=json.loads(failed_path.read_text()) if failed_path.exists() else {}
        w,token,key=bindings();rows=pending(w,token,args.limit,failed)
        summary={'pending':len(rows),'estimated_source_bytes':sum(r['bytes'] for r in rows),
                 'created':0,'source_bytes':0,'preview_bytes':0,'errors':0,'apply':args.apply,
                 'quarantined_versions':len(failed),'systemic_stop':False,
                 'budget_stop':False,'freshness_blocked':False}
        if not args.apply:print(json.dumps(summary));return 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for i in range(0,len(rows),4):
                batch=rows[i:i+4]
                if not reserve_batch(budget_path,budget,batch):
                    summary['budget_stop']=True;break
                futures=[pool.submit(create_one,r,key) for r in batch];created=[]
                for row,f in zip(batch,futures):
                    identity=row['bucket_id']+'/'+row['name']
                    try:
                        result=f.result();summary['created']+=1
                        created.append(row)
                        failed.pop(identity,None)
                        for field in ('source_bytes','preview_bytes'):summary[field]+=result[field]
                    except Exception as exc:
                        summary['errors']+=1
                        print('Preview error:',type(exc).__name__,getattr(exc,'code',''))
                        per_image=isinstance(exc,(InvalidSourceImage,UnidentifiedImageError,
                            Image.DecompressionBombWarning,Image.DecompressionBombError))
                        per_image=per_image or (isinstance(exc,urllib.error.HTTPError) and exc.code in (404,412))
                        if per_image:
                            failed[identity]={'etag':row['etag'],'source_updated_at':row['source_updated_at'],
                                              'reason':type(exc).__name__}
                        else:summary['systemic_stop']=True
                save_json(failed_path,failed)
                if created:
                    try:verified=verify_created(w,token,created)
                    except Exception:verified=False
                    if not verified:
                        budget['blocked']='Uploaded previews could not be verified; repair metadata before clearing this circuit.'
                        save_json(budget_path,budget);summary['freshness_blocked']=True;summary['errors']+=1
                        break
                if summary['systemic_stop']:break
        summary['quarantined_versions']=len(failed)
        summary['completed_at']=time.time()
        save_json(state/'last-run.json',summary)
        print(json.dumps(summary))
        return 1 if summary['errors'] or summary['budget_stop'] else 0

if __name__=='__main__':raise SystemExit(main())
