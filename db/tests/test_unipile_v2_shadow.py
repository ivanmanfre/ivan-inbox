"""Real PostgreSQL 17 tests on a fresh private Unix-socket cluster. No live DB."""
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'db/20261116_unipile_v2_shadow.sql'
PG = Path(subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
EVENT = {'id': 'evt_synthetic', 'created_at': '2026-11-16T19:00:00Z',
         'account_id': 'acc_synthetic', 'application_id': 'app_synthetic',
         'application_production': False, 'type': 'message.new',
         'payload': {'id': 'CLASSIC_synthetic', 'is_sender': False}}


class ShadowPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix='unipile-shadow-pg-'))
        cls.data = cls.tmp / 'data'
        cls.env = dict(os.environ, PGHOST=str(cls.tmp), PGPORT='6547', PGUSER='postgres', PGDATABASE='postgres')
        subprocess.run([str(PG / 'initdb'), '-D', str(cls.data), '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.data), '-l', str(cls.tmp / 'server.log'),
                        '-o', f"-k {cls.tmp} -p 6547 -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        cls.addClassCleanup(cls.stop)
        cls.sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')

    @classmethod
    def stop(cls):
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cls.data), '-m', 'immediate', '-w', 'stop'], capture_output=True)
        shutil.rmtree(cls.tmp)

    @classmethod
    def sql(cls, sql, check=True):
        result = subprocess.run([str(PG / 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1'],
                                input=sql, text=True, env=cls.env, capture_output=True, timeout=10)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip() if check else result

    def setUp(self):
        self.assertTrue(MIGRATION.exists(), 'PostgreSQL shadow migration is missing')
        self.sql('DROP SCHEMA IF EXISTS unipile_v2_shadow CASCADE;')
        self.sql(MIGRATION.read_text())
        self.sql("""INSERT INTO unipile_v2_shadow.endpoints
            (id,client_id,application_id,account_id,production,enabled,expires_at)
            VALUES ('endpoint-synthetic','ivan','app_synthetic','acc_synthetic',false,true,clock_timestamp()+interval '1 day');""")

    def accept(self, event=EVENT, raw=None):
        encoded = base64.b64encode((raw if raw is not None else json.dumps(event)).encode()).decode()
        return self.sql(f"SET ROLE service_role; SELECT public.unipile_v2_shadow_accept('endpoint-synthetic','{encoded}');")

    def test_replays_are_atomic_and_reformatting_is_not_a_conflict(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            receipts = list(pool.map(lambda _: self.accept(), range(6)))
        self.assertEqual(receipts.count('stored'), 1)
        self.assertEqual(receipts.count('duplicate'), 5)
        self.assertEqual(self.accept(raw=json.dumps(EVENT, indent=2)), 'duplicate')
        self.assertEqual(self.sql('SELECT count(*) FROM unipile_v2_shadow.events;'), '1')
        self.assertEqual(self.sql('SELECT event_count FROM unipile_v2_shadow.endpoints;'), '1')

    def test_conflicting_event_id_preserves_original(self):
        self.accept()
        self.assertEqual(self.accept({**EVENT, 'payload': {'text': 'different'}}), 'conflict')
        self.assertEqual(self.sql("SELECT event->'payload'->>'id' FROM unipile_v2_shadow.events;"), 'CLASSIC_synthetic')
        self.assertEqual(self.sql('SELECT event_count FROM unipile_v2_shadow.endpoints;'), '1')

    def test_scope_binding_disabled_and_expired_stop_before_write(self):
        for change in [{'account_id': 'acc_other'}, {'application_id': 'app_other'}, {'application_production': True}]:
            self.assertEqual(self.accept({**EVENT, **change}), 'rejected_scope')
        self.sql('UPDATE unipile_v2_shadow.endpoints SET enabled=false;')
        self.assertEqual(self.accept(), 'disabled')
        self.sql("UPDATE unipile_v2_shadow.endpoints SET enabled=true,expires_at=clock_timestamp()-interval '1 second';")
        self.assertEqual(self.accept(), 'disabled')
        self.assertEqual(self.sql('SELECT count(*) FROM unipile_v2_shadow.events;'), '0')

    def test_capacity_is_atomic_and_duplicates_do_not_consume_it(self):
        self.sql('UPDATE unipile_v2_shadow.endpoints SET max_events=1;')
        self.assertEqual(self.accept(), 'stored')
        self.assertEqual(self.accept(), 'duplicate')
        self.assertEqual(self.accept({**EVENT, 'id': 'evt_second'}), 'capacity')
        self.assertEqual(self.sql('SELECT event_count FROM unipile_v2_shadow.endpoints;'), '1')

    def test_anon_authenticated_and_direct_service_writes_are_denied(self):
        for role in ['anon', 'authenticated']:
            for query in ["SELECT public.unipile_v2_shadow_accept('x','e30=');",
                          'SELECT * FROM unipile_v2_shadow.events;',
                          'SELECT public.unipile_v2_shadow_prune();']:
                result = self.sql(f'SET ROLE {role}; {query}', check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('permission denied', result.stderr)
        result = self.sql("SET ROLE service_role; UPDATE unipile_v2_shadow.endpoints SET enabled=true;", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_policies WHERE schemaname='unipile_v2_shadow';"), '0')
        self.assertEqual(self.sql("SELECT bool_and(relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='unipile_v2_shadow' AND relkind='r';"), 't')

    def test_failed_transaction_does_not_increment_counters(self):
        self.sql("""CREATE FUNCTION unipile_v2_shadow.fail_write() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic storage fault'; END$$;
            CREATE TRIGGER test_failure BEFORE INSERT ON unipile_v2_shadow.events FOR EACH ROW EXECUTE FUNCTION unipile_v2_shadow.fail_write();""")
        with self.assertRaisesRegex(AssertionError, 'synthetic storage fault'):
            self.accept()
        self.assertEqual(self.sql('SELECT event_count FROM unipile_v2_shadow.endpoints;'), '0')
        self.sql('DROP TRIGGER test_failure ON unipile_v2_shadow.events;')
        self.assertEqual(self.accept(), 'stored')

    def test_prune_removes_expired_data_and_releases_only_its_capacity(self):
        self.accept()
        self.accept({**EVENT, 'id': 'evt_keep'})
        self.sql("UPDATE unipile_v2_shadow.events SET expires_at=clock_timestamp()-interval '1 second' WHERE event_id='evt_synthetic';")
        self.assertEqual(self.sql('SET ROLE service_role; SELECT public.unipile_v2_shadow_prune();'), '1')
        self.assertEqual(self.sql('SELECT event_id FROM unipile_v2_shadow.events;'), 'evt_keep')
        self.assertEqual(self.sql('SELECT event_count FROM unipile_v2_shadow.endpoints;'), '1')
        self.assertEqual(self.sql('SELECT e.total_bytes=sum(octet_length(v.raw_body)) FROM unipile_v2_shadow.endpoints e JOIN unipile_v2_shadow.events v ON v.endpoint_id=e.id GROUP BY e.id;'), 't')

    def test_acknowledged_event_survives_immediate_database_restart(self):
        self.assertEqual(self.accept(), 'stored')
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(self.data), '-m', 'immediate', '-w', 'restart', '-l', str(self.tmp / 'server.log')], check=True, capture_output=True)
        self.assertEqual(self.accept(), 'duplicate')
        self.assertEqual(self.sql('SELECT count(*) FROM unipile_v2_shadow.events;'), '1')


if __name__ == '__main__':
    unittest.main()
