import contextlib,hashlib,importlib.util,io,json,pathlib,sys,tempfile,types,unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('preview_guard',pathlib.Path(__file__).with_name('guard.py'))
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)

class ProtectionHealth(unittest.TestCase):
    def healthy(self):
        return {'last_run':{'completed_at':200000,'errors':0},'budget':{},
                'job_exit':0,'job_loaded':True,'poller_disabled':True,'files_match':True}

    def test_current_protections_need_no_alarm(self):
        self.assertEqual(g.issues(self.healthy(),200001),[])

    def test_missing_or_stale_refresh_is_visible(self):
        for stamp in [None,1,float('nan'),300000]:
            s=self.healthy();s['last_run']['completed_at']=stamp
            self.assertIn('Preview refresh has no recent verified completion',g.issues(s,200001))

    def test_detects_failed_jobs_open_circuits_and_changed_runtime(self):
        cases=[('job_exit',1,'Preview launchd job failed'),('job_loaded',False,'Preview launchd job is unloaded'),
               ('poller_disabled',False,'Expensive Storage log poller is enabled'),
               ('files_match',False,'Installed quota protection files differ from the verified install')]
        for field,value,expected in cases:
            s=self.healthy();s[field]=value
            self.assertIn(expected,g.issues(s,200001))
        s=self.healthy();s['budget']['blocked']='metadata mismatch'
        self.assertIn('Preview freshness circuit is open',g.issues(s,200001))
        s=self.healthy();s['last_run']['budget_stop']=True
        self.assertIn('Preview download budget stopped the job',g.issues(s,200001))

    def test_same_problem_cannot_notify_every_hour(self):
        previous={'problems':['broken'],'last_alert_at':200000}
        self.assertFalse(g.should_notify(previous,['broken'],203600))
        self.assertTrue(g.should_notify(previous,['different'],203600))
        self.assertTrue(g.should_notify(previous,['broken'],290000))
        self.assertFalse(g.should_notify(previous,[],203600))

    def test_healthy_hourly_command_uses_only_local_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=pathlib.Path(tmp);source=state/'generate.py';source.write_text('fixture')
            (state/'installed.json').write_text(json.dumps({'sha256':{str(source):hashlib.sha256(source.read_bytes()).hexdigest()}}))
            (state/'last-run.json').write_text(json.dumps({'completed_at':200000,'errors':0}))
            def local_command(args,**kwargs):
                return types.SimpleNamespace(returncode=0,stdout='"com.ivan.supabase-storage-egress-watch" => disabled' if 'print-disabled' in args else 'last exit code = 0')
            with patch.object(g,'STATE',state),patch.object(g.subprocess,'run',side_effect=local_command),patch.object(g.time,'time',return_value=200001),patch.object(sys,'argv',['guard','--client-id','ivan','--notify']),patch.object(g,'notify',side_effect=AssertionError('healthy guard reached credentials/network')),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(g.main(),0)
            result=json.loads((state/'guard-last-run.json').read_text())
            self.assertEqual(result['problems'],[])
            self.assertFalse(result['notified'])

if __name__=='__main__':unittest.main()
