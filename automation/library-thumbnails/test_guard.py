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

    def test_detects_failed_jobs_usage_warnings_and_changed_runtime(self):
        cases=[('job_exit',1,'Preview launchd job failed'),('job_loaded',False,'Preview launchd job is unloaded'),
               ('poller_disabled',False,'Expensive Storage log poller is enabled'),
               ('files_match',False,'Installed quota protection files differ from the verified install')]
        for field,value,expected in cases:
            s=self.healthy();s[field]=value
            self.assertIn(expected,g.issues(s,200001))
        for flag,expected in [('budget_warning','Preview downloads exceeded warning threshold; processing continues'),('freshness_warning','Preview metadata could not be verified; processing continues'),('budget_unverified','Preview usage accounting needs repair; processing continues')]:
            s=self.healthy();s['last_run'][flag]=True
            self.assertIn(expected,g.issues(s,200001))

    def test_same_problem_cannot_notify_every_hour(self):
        previous={'problems':['broken'],'alerted_problems':['broken'],'last_alert_at':200000}
        self.assertFalse(g.should_notify(previous,['broken'],203600))
        self.assertTrue(g.should_notify(previous,['different'],203600))
        self.assertTrue(g.should_notify(previous,['broken'],290000))
        self.assertFalse(g.should_notify(previous,[],203600))

    def test_reboot_before_calendar_job_runs_is_not_a_failure(self):
        s=self.healthy();s['job_exit']=None
        self.assertEqual(g.issues(s,200001),[])
        s['last_run']['completed_at']=1
        self.assertIn('Preview refresh has no recent verified completion',g.issues(s,200001))

    def test_healthy_intervals_do_not_reset_the_alert_cooldown(self):
        previous={'problems':[],'alerted_problems':['broken'],'last_alert_at':200000}
        self.assertFalse(g.should_notify(previous,['broken'],203600))

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

    def test_flapping_problems_keep_cooldown_and_any_successful_relay_status(self):
        a=self.healthy();a['job_loaded']=False
        b=self.healthy();b['files_match']=False
        deliveries=[]
        def deliver(text):deliveries.append(text);return 202
        with tempfile.TemporaryDirectory() as tmp,patch.object(g,'STATE',pathlib.Path(tmp)),patch.object(g,'snapshot',side_effect=[a,self.healthy(),a,b,a]),patch.object(g.time,'time',side_effect=[200001,203601,207201,210801,214401]),patch.object(g,'notify',side_effect=deliver),patch.object(sys,'argv',['guard','--client-id','ivan','--notify']),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual([g.main() for _ in range(5)],[1,0,1,1,1])
            result=json.loads((pathlib.Path(tmp)/'guard-last-run.json').read_text())
        self.assertEqual(len(deliveries),2)
        self.assertFalse(result['notified'])
        self.assertEqual(len(result['alert_history']),2)

if __name__=='__main__':unittest.main()
