import importlib.util,io,pathlib,unittest
import contextlib,json,sys,tempfile,types,urllib.error
from unittest.mock import patch
from PIL import UnidentifiedImageError
from PIL import Image

SCRIPT=pathlib.Path(__file__).with_name('generate.py')

class ThumbnailContract(unittest.TestCase):
    def setUp(self):
        s=importlib.util.spec_from_file_location('thumbnail_job',SCRIPT)
        self.m=importlib.util.module_from_spec(s);s.loader.exec_module(self.m)

    def test_preview_is_small_webp_and_source_bytes_stay_unchanged(self):
        f=io.BytesIO();Image.new('RGB',(1600,1000),'orange').save(f,'PNG')
        raw=f.getvalue();before=bytes(raw)
        result=self.m.make_thumbnail(raw)
        with Image.open(io.BytesIO(result)) as image:
            self.assertEqual(image.format,'WEBP')
            self.assertEqual(image.size,(480,300))
        self.assertLess(len(result),10000)
        self.assertEqual(raw,before)

    def test_transparency_survives_and_preview_path_cannot_equal_original(self):
        f=io.BytesIO();Image.new('RGBA',(1000,3000),(1,2,3,100)).save(f,'PNG')
        with Image.open(io.BytesIO(self.m.make_thumbnail(f.getvalue()))) as image:
            self.assertEqual(image.size,(200,600))
            self.assertIn('A',image.getbands())
        self.assertEqual(self.m.thumbnail_path('library/a photo.png'),'_library-thumbnails/w480-h600-q75/library/a photo.png.webp')
        with self.assertRaises(ValueError):self.m.thumbnail_path('_library-thumbnails/w480-h600-q75/a.png')
        with self.assertRaises(ValueError):self.m.thumbnail_path('../a.png')

    def test_exif_orientation_is_applied(self):
        f=io.BytesIO();image=Image.new('RGB',(400,800),'blue');exif=Image.Exif();exif[274]=6
        image.save(f,'JPEG',exif=exif)
        with Image.open(io.BytesIO(self.m.make_thumbnail(f.getvalue()))) as preview:
            self.assertEqual(preview.size,(480,240))

    def test_bad_images_are_remembered_and_later_valid_images_finish(self):
        rows=[{'bucket_id':'post-stills','name':f'library/bad-{i}.png','etag':'e','source_updated_at':'t','bytes':10} for i in range(8)]
        rows.append(dict(rows[0],name='library/good.png'))
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda token,q:[{'mismatches':0}] if 'as expected' in q else rows),'token','key')
        def create(row,key):
            if 'bad-' in row['name']:raise UnidentifiedImageError('fixture')
            return {'source_bytes':10,'preview_bytes':2}
        self.m.create_one=create
        with tempfile.TemporaryDirectory() as tmp, patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)), patch.object(sys,'argv',['generate','--client-id','ivan','--apply']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.main(),1)
            state=pathlib.Path(tmp)/'.local/state/library-thumbnails'
            result=json.loads((state/'last-run.json').read_text())
            self.assertEqual(result['created'],1,'bad originals blocked later valid images')
            failed=json.loads((state/'failed.json').read_text())
            self.assertEqual(len(failed),8)
            self.assertEqual(failed['post-stills/library/bad-0.png']['etag'],'e')

    def test_systemic_failure_stops_without_quarantining_images(self):
        rows=[{'bucket_id':'post-stills','name':'library/a.png','etag':'e','source_updated_at':'t','bytes':10}]
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda *a:rows),'token','key')
        def create(*a):raise urllib.error.HTTPError('fixture',403,'Forbidden',{},None)
        self.m.create_one=create
        with tempfile.TemporaryDirectory() as tmp, patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)), patch.object(sys,'argv',['generate','--client-id','ivan','--apply']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.main(),1)
            state=pathlib.Path(tmp)/'.local/state/library-thumbnails'
            result=json.loads((state/'last-run.json').read_text())
            self.assertTrue(result.get('systemic_stop',False))
            self.assertEqual(json.loads((state/'failed.json').read_text()),{})

    def test_repeated_runs_warn_after_threshold_but_keep_working(self):
        row={'bucket_id':'post-stills','name':'library/a.png','etag':'e','source_updated_at':'t','bytes':10}
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda token,q:[{'mismatches':0}] if 'as expected' in q else [row]),'token','key')
        self.m.create_one=lambda *a:{'source_bytes':10,'preview_bytes':2}
        with tempfile.TemporaryDirectory() as tmp, patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)), patch.object(sys,'argv',['generate','--client-id','ivan','--apply']), contextlib.redirect_stdout(io.StringIO()):
            self.m.DAILY_SOURCE_BUDGET=15
            state=pathlib.Path(tmp)/'.local/state/library-thumbnails'
            with patch.object(self.m.time,'time',return_value=100000):
                self.assertEqual(self.m.main(),0)
                self.assertEqual(self.m.main(),0,'usage warning blocked preview work')
                result=json.loads((state/'last-run.json').read_text())
                self.assertEqual(result['source_bytes'],10)
                self.assertTrue(result['budget_warning'])
            with patch.object(self.m.time,'time',return_value=190000):
                self.assertEqual(self.m.main(),0)
                self.assertEqual(json.loads((state/'last-run.json').read_text())['created'],1)
                self.assertFalse(json.loads((state/'last-run.json').read_text())['budget_warning'])

    def test_missing_metadata_warns_without_stopping_batches_or_future_runs(self):
        rows=[{'bucket_id':'post-stills','name':f'library/{i}.png','etag':'e','source_updated_at':'t','bytes':10} for i in range(8)]
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda token,q:[{'mismatches':4}] if 'as expected' in q else rows),'token','key')
        self.m.create_one=lambda *a:{'source_bytes':10,'preview_bytes':2}
        with tempfile.TemporaryDirectory() as tmp, patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)), patch.object(sys,'argv',['generate','--client-id','ivan','--apply']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.m.main(),0)
            state=pathlib.Path(tmp)/'.local/state/library-thumbnails'
            result=json.loads((state/'last-run.json').read_text())
            self.assertEqual(result['created'],8)
            self.assertTrue(result['freshness_warning'])
            self.assertEqual(self.m.main(),0)
            self.assertEqual(json.loads((state/'last-run.json').read_text())['created'],8)

    def test_corrupt_budget_warns_and_preserves_history_without_blocking_work(self):
        row={'bucket_id':'post-stills','name':'library/a.png','etag':'e','source_updated_at':'t','bytes':10}
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda token,q:[{'mismatches':0}] if 'as expected' in q else [row]),'token','key')
        self.m.create_one=lambda *a:{'source_bytes':10,'preview_bytes':2}
        with tempfile.TemporaryDirectory() as tmp, patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)), patch.object(sys,'argv',['generate','--client-id','ivan','--apply']),contextlib.redirect_stdout(io.StringIO()):
            state=pathlib.Path(tmp)/'.local/state/library-thumbnails';state.mkdir(parents=True)
            (state/'budget.json').write_text('{"reservations":[{"at":1,"bytes":-100}]}')
            before=(state/'budget.json').read_bytes()
            self.assertEqual(self.m.main(),0)
            result=json.loads((state/'last-run.json').read_text())
            self.assertEqual(result['created'],1)
            self.assertTrue(result['budget_unverified'])
            self.assertEqual((state/'budget.json').read_bytes(),before)

    def test_source_read_cannot_exceed_its_reserved_size(self):
        row={'bucket_id':'post-stills','name':'library/a.png','etag':'e','source_updated_at':'t','bytes':10}
        reads=[]
        class Response:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self,limit):reads.append(limit);return b'x'*limit
        with patch.object(self.m.urllib.request,'urlopen',return_value=Response()):
            with self.assertRaises(self.m.InvalidSourceImage):self.m.create_one(row,'fixture-key')
        self.assertEqual(reads,[11],'untrusted metadata allowed an unbudgeted original download')

    def test_legacy_stop_is_removed_without_resetting_usage_history(self):
        row={'bucket_id':'post-stills','name':'library/a.png','etag':'e','source_updated_at':'t','bytes':10}
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda token,q:[{'mismatches':0}] if 'as expected' in q else [row]),'token','key')
        self.m.create_one=lambda *a:{'source_bytes':10,'preview_bytes':2}
        with tempfile.TemporaryDirectory() as tmp,patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)),patch.object(sys,'argv',['generate','--client-id','ivan','--apply']),contextlib.redirect_stdout(io.StringIO()),patch.object(self.m.time,'time',return_value=100000):
            state=pathlib.Path(tmp)/'.local/state/library-thumbnails';state.mkdir(parents=True)
            (state/'budget.json').write_text(json.dumps({'reservations':[{'at':99999,'bytes':50}],'blocked':'old metadata failure'}))
            self.assertEqual(self.m.main(),0)
            result=json.loads((state/'budget.json').read_text())
            self.assertEqual(result['mode'],'warn_only')
            self.assertEqual(sum(r['bytes'] for r in result['reservations']),61)
            self.assertEqual(result['previous_block_reason'],'old metadata failure')
            self.assertFalse(result.get('blocked'))

    def test_failed_get_keeps_its_reservation_for_the_next_invocation(self):
        row={'bucket_id':'post-stills','name':'library/a.png','etag':'e','source_updated_at':'t','bytes':10}
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda *a:[row]),'token','key')
        self.m.DAILY_SOURCE_BUDGET=15
        failure=urllib.error.HTTPError('fixture',503,'Unavailable',{},None)
        self.addCleanup(failure.close)
        with tempfile.TemporaryDirectory() as tmp, patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)), patch.object(sys,'argv',['generate','--client-id','ivan','--apply']), contextlib.redirect_stdout(io.StringIO()), patch.object(self.m.urllib.request,'urlopen',side_effect=failure):
            self.assertEqual(self.m.main(),1)
            self.assertEqual(self.m.main(),1)
            state=pathlib.Path(tmp)/'.local/state/library-thumbnails'
            result=json.loads((state/'last-run.json').read_text())
            self.assertTrue(result['budget_warning'])
            self.assertFalse(result.get('budget_stop',False))
            self.assertEqual(result['source_bytes'],0)

    def test_large_backlog_finishes_without_a_usage_cutoff(self):
        rows=[{'bucket_id':'post-stills','name':f'library/{i}.png','etag':'e','source_updated_at':'t','bytes':10*1024*1024} for i in range(60)]
        completed=set()
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda token,q:[{'mismatches':0}] if 'as expected' in q else [r for r in rows if r['name'] not in completed]),'token','key')
        def create(row,key):
            completed.add(row['name']);return {'source_bytes':row['bytes'],'preview_bytes':2}
        self.m.create_one=create
        with tempfile.TemporaryDirectory() as tmp,patch.object(pathlib.Path,'home',return_value=pathlib.Path(tmp)),patch.object(sys,'argv',['generate','--client-id','ivan','--apply']),contextlib.redirect_stdout(io.StringIO()):
            with patch.object(self.m.time,'time',return_value=100000):
                self.assertEqual(self.m.main(),0)
                self.assertEqual(len(completed),60)
            with patch.object(self.m.time,'time',return_value=190000):
                self.assertEqual(self.m.main(),0)
                self.assertEqual(len(completed),60)

if __name__=='__main__':unittest.main()
