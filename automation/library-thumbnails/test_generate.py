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
        self.m.bindings=lambda:(types.SimpleNamespace(sql=lambda *a:rows),'token','key')
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

if __name__=='__main__':unittest.main()
