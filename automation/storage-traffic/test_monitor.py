import contextlib,datetime as dt,importlib.util,io,json,pathlib,sys,tempfile,unittest,urllib.parse
from unittest.mock import patch

s=importlib.util.spec_from_file_location('storage_monitor',pathlib.Path(__file__).with_name('monitor.py'))
m=importlib.util.module_from_spec(s)
if s.loader:s.loader.exec_module(m)

class StorageTraffic(unittest.TestCase):
    def test_request_has_matching_finite_sql_and_api_time_bounds(self):
        url=m.logs_url(0,900)
        q=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(q['iso_timestamp_start'],['1970-01-01T00:00:00Z'])
        self.assertEqual(q['iso_timestamp_end'],['1970-01-01T00:15:00Z'])
        self.assertIn("timestamp >= parseDateTime64BestEffort('1970-01-01T00:00:00Z')",q['sql'][0])
        self.assertIn("timestamp < parseDateTime64BestEffort('1970-01-01T00:15:00Z')",q['sql'][0])
        self.assertIn("LIKE '/storage/%'",q['sql'][0])
        for start,end in [(0,901),(0,86400),(-1,899),(900,0)]:
            with self.assertRaises(ValueError):m.logs_url(start,end)

    def test_cached_windows_are_not_fetched_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'state.json';state=m.load_state(path,900)
            fetched=[]
            def fetch(a,b):fetched.append((a,b));return {'requests':2,'bytes':500,'unknown_lengths':0}
            m.collect(state,path,1200,fetch)
            state=m.load_state(path,900);m.collect(state,path,1200,fetch)
            m.collect(state,path,2100,fetch)
            self.assertEqual(fetched,[(0,900),(900,1800)])

    def test_failed_or_interrupted_window_is_recorded_before_query_and_never_retried_automatically(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'state.json';state=m.load_state(path,900)
            def fail(a,b):
                saved=json.loads(path.read_text());self.assertEqual(saved['cursor'],900)
                self.assertEqual(saved['windows']['0']['status'],'pending')
                raise TimeoutError('fixture')
            m.collect(state,path,1200,fail)
            m.collect(state,path,1200,lambda *a:self.fail('failed window was re-scanned'))
            self.assertEqual(state['windows']['0']['status'],'error')
            self.assertIn('coverage',m.alert_candidates(state,900))

    def test_old_cursor_cannot_trigger_a_wide_historical_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'state.json';state=m.load_state(path,900)
            fetched=[]
            m.collect(state,path,200000,lambda a,b:fetched.append((a,b)) or {'requests':0,'bytes':0,'unknown_lengths':0})
            self.assertLessEqual(len(fetched),4)
            self.assertTrue(all(b-a==900 and a>=m.eligible_end(200000)-86400 for a,b in fetched))

    def test_alerts_use_cached_response_bytes_and_preserve_partial_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            state=m.load_state(pathlib.Path(tmp)/'state.json',900)
            state['cursor']=900;state['windows']['0']={'status':'ok','requests':4,'bytes':2_000_000_000,'unknown_lengths':0}
            alerts=m.alert_candidates(state,900)
            self.assertIn('hour',alerts)
            self.assertIn('1/4',alerts['hour'])
            state['alerts']['hour']=1000
            self.assertNotIn('hour',m.due_alerts(state,alerts,1100))
            self.assertIn('hour',m.due_alerts(state,alerts,12000))

    def test_api_errors_and_missing_size_headers_are_visible(self):
        for value in [{'error':'fixture'},{'result':[]},{'result':[{'requests':1,'bytes':-2,'unknown_lengths':0}]}]:
            with self.assertRaises(ValueError):m.parse_response(value)
        with tempfile.TemporaryDirectory() as tmp:
            state=m.load_state(pathlib.Path(tmp)/'s.json',900);state['cursor']=900
            state['windows']['0']={'status':'ok','requests':4,'bytes':0,'unknown_lengths':4}
            self.assertIn('sizes',m.alert_candidates(state,900))

    def test_transient_gap_does_not_silence_later_monitor_outage(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'state.json';state=m.load_state(path,900)
            def fail(*args):raise TimeoutError('fixture')
            m.collect(state,path,1200,fail)
            first=m.due_alerts(state,m.alert_candidates(state,900),1200)
            for kind in first:state['alerts'][kind]=1200
            # Recovery leaves the old gap in the day, then collection fails
            # again four hours later while coverage's cooldown still applies.
            for end in range(1800,15301,900):
                m.collect(state,path,end+300,lambda *a:{'requests':1,'bytes':0,'unknown_lengths':0})
            m.collect(state,path,16500,fail)
            due=m.due_alerts(state,m.alert_candidates(state,16200),16500)
            self.assertNotIn('coverage',due)
            self.assertIn('monitor_down',due)
            state['alerts']['monitor_down']=16500
            self.assertNotIn('monitor_down',m.due_alerts(state,m.alert_candidates(state,16200),17400))
            self.assertIn('monitor_down',m.due_alerts(state,m.alert_candidates(state,16200),27300))

    def test_catchup_backlog_does_not_count_unattempted_intervals_as_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'state.json';state=m.load_state(path,900)
            state['cursor']=900
            state['windows']['0']={'status':'ok','requests':0,'bytes':0,'unknown_lengths':0}
            m.collect(state,path,12000,lambda *a:{'requests':0,'bytes':0,'unknown_lengths':0})
            self.assertLess(state['cursor'],m.eligible_end(12000))
            candidates=m.alert_candidates(state,m.eligible_end(12000))
            self.assertNotIn('coverage',candidates)
            self.assertNotIn('monitor_down',candidates)

    def test_corrupt_state_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'state.json';path.write_text('{broken')
            with self.assertRaises(ValueError):m.load_state(path,900)
            self.assertEqual(path.read_text(),'{broken')

    def test_query_attempt_budget_does_not_repeat_or_expand_queries(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'state.json';state=m.load_state(path,900)
            state['attempts']=[1199]*192
            m.collect(state,path,1200,lambda *a:self.fail('attempt budget bypassed'))
            self.assertEqual(state['cursor'],0)
            self.assertIn('query_budget',m.alert_candidates(state,900))

    def test_default_status_check_uses_no_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(sys,'argv',['monitor','--client-id','ivan','--state-dir',tmp]),patch.object(m,'credentials',side_effect=AssertionError('status read credentials')),patch.object(m,'request_json',side_effect=AssertionError('status used network')),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(),0)

    def test_clock_rollback_does_not_requery_saved_periods(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'s.json';state=m.load_state(path,1800);state['cursor']=1800
            m.collect(state,path,1200,lambda *a:self.fail('clock rollback caused a rescan'))
            self.assertIn('clock',m.alert_candidates(state,900))

    def test_rejected_notification_does_not_consume_cooldown(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=pathlib.Path(tmp);state=m.load_state(directory/'state.json',900)
            state['cursor']=900;state['windows']['0']={'status':'ok','requests':1,'bytes':2_000_000_000,'unknown_lengths':0}
            m.save(directory/'state.json',state)
            with patch.object(sys,'argv',['monitor','--client-id','ivan','--state-dir',tmp,'--notify']),patch.object(m.time,'time',return_value=1200),patch.object(m,'credentials',return_value='{"key":"fixture","number":"fixture"}'),patch.object(m,'send',side_effect=ValueError('fixture')),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.main(),1)
            self.assertEqual(json.loads((directory/'state.json').read_text())['alerts'],{})

    def test_plain_successful_acknowledgement_sets_cooldown_once(self):
        sent=[]
        class Response:
            status=202
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self,limit):return b'Accepted'
        def accept(request,**kwargs):sent.append(request);return Response()
        with tempfile.TemporaryDirectory() as tmp:
            directory=pathlib.Path(tmp);state=m.load_state(directory/'state.json',900)
            state['cursor']=900;state['windows']['0']={'status':'ok','requests':1,'bytes':2_000_000_000,'unknown_lengths':0}
            m.save(directory/'state.json',state)
            with patch.object(sys,'argv',['monitor','--client-id','ivan','--state-dir',tmp,'--notify']),patch.object(m.time,'time',return_value=1200),patch.object(m,'credentials',return_value='{"key":"fixture","number":"fixture"}'),patch.object(m.urllib.request,'urlopen',side_effect=accept),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.main(),0);self.assertEqual(m.main(),0)
            self.assertEqual(len(sent),1)
            self.assertEqual(json.loads(sent[0].data)['number'],'fixture')
            self.assertEqual(json.loads((directory/'state.json').read_text())['alerts']['hour'],1200)

    def test_recorded_historical_storage_spike_generates_the_expected_warning(self):
        row=json.loads(pathlib.Path(__file__).with_name('historical-spike.json').read_text())
        end=int(dt.datetime.fromisoformat(row['end'].replace('Z','+00:00')).timestamp());start=end-900
        state={'started':start,'cursor':end,'alerts':{},'windows':{str(start):{'status':'ok',**row}}}
        alerts=m.alert_candidates(state,end)
        self.assertIn('1.11 GB',alerts['hour'])
        self.assertIn('1/4',alerts['hour'])

if __name__=='__main__':unittest.main()
