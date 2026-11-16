-- Additive, isolated quarantine only. No production messages, queues or triggers.
BEGIN;
CREATE SCHEMA IF NOT EXISTS unipile_v2_shadow;
REVOKE ALL ON SCHEMA unipile_v2_shadow FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS unipile_v2_shadow.endpoints (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 256),
  client_id text NOT NULL CHECK (client_id = 'ivan'),
  application_id text NOT NULL CHECK (length(application_id) BETWEEN 1 AND 256),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
  production boolean NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  max_events integer NOT NULL DEFAULT 10000 CHECK (max_events BETWEEN 1 AND 10000),
  max_bytes bigint NOT NULL DEFAULT 134217728 CHECK (max_bytes BETWEEN 1 AND 134217728),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  total_bytes bigint NOT NULL DEFAULT 0 CHECK (total_bytes >= 0)
);
CREATE TABLE IF NOT EXISTS unipile_v2_shadow.events (
  endpoint_id text NOT NULL REFERENCES unipile_v2_shadow.endpoints(id),
  event_id text NOT NULL,
  event jsonb NOT NULL,
  raw_body bytea NOT NULL CHECK (octet_length(raw_body) <= 1048576),
  state text NOT NULL DEFAULT 'quarantined' CHECK (state = 'quarantined'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '7 days'),
  PRIMARY KEY (endpoint_id, event_id)
);
CREATE INDEX IF NOT EXISTS unipile_v2_shadow_events_expiry
  ON unipile_v2_shadow.events (endpoint_id, expires_at);
ALTER TABLE unipile_v2_shadow.endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE unipile_v2_shadow.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA unipile_v2_shadow FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unipile_v2_shadow_accept(p_endpoint_id text, p_body_base64 text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '500ms'
AS $$
DECLARE
  cfg unipile_v2_shadow.endpoints%ROWTYPE;
  raw bytea;
  incoming jsonb;
  previous jsonb;
BEGIN
  IF p_body_base64 IS NULL OR length(p_body_base64) > 1398104 THEN RETURN 'invalid'; END IF;
  BEGIN
    raw := decode(p_body_base64, 'base64');
    IF octet_length(raw) > 1048576 THEN RETURN 'invalid'; END IF;
    incoming := convert_from(raw, 'UTF8')::jsonb;
    IF jsonb_typeof(incoming) IS DISTINCT FROM 'object'
      OR jsonb_typeof(incoming->'payload') IS DISTINCT FROM 'object'
      OR coalesce(incoming->>'id', '') !~ '^evt_.+'
      OR length(incoming->>'id') > 256
      OR coalesce(length(incoming->>'type'), 0) NOT BETWEEN 1 AND 128
      OR jsonb_typeof(incoming->'created_at') IS DISTINCT FROM 'string'
    THEN RETURN 'invalid'; END IF;
    PERFORM (incoming->>'created_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR character_not_in_repertoire
    OR invalid_datetime_format OR datetime_field_overflow THEN RETURN 'invalid';
  END;
  SELECT * INTO cfg FROM unipile_v2_shadow.endpoints WHERE id=p_endpoint_id FOR UPDATE;
  IF NOT FOUND OR NOT cfg.enabled OR cfg.expires_at <= clock_timestamp() THEN RETURN 'disabled'; END IF;
  IF incoming->>'application_id' IS DISTINCT FROM cfg.application_id
    OR incoming->>'account_id' IS DISTINCT FROM cfg.account_id
    OR incoming->'application_production' IS DISTINCT FROM to_jsonb(cfg.production)
  THEN RETURN 'rejected_scope'; END IF;
  SELECT event INTO previous FROM unipile_v2_shadow.events
    WHERE endpoint_id=p_endpoint_id AND event_id=incoming->>'id';
  IF FOUND THEN
    IF previous = incoming THEN RETURN 'duplicate'; ELSE RETURN 'conflict'; END IF;
  END IF;
  IF cfg.event_count >= cfg.max_events OR cfg.total_bytes + octet_length(raw) > cfg.max_bytes
    THEN RETURN 'capacity'; END IF;
  INSERT INTO unipile_v2_shadow.events(endpoint_id,event_id,event,raw_body)
    VALUES(p_endpoint_id,incoming->>'id',incoming,raw);
  UPDATE unipile_v2_shadow.endpoints SET event_count=event_count+1,
    total_bytes=total_bytes+octet_length(raw) WHERE id=p_endpoint_id;
  RETURN 'stored';
END;
$$;

CREATE OR REPLACE FUNCTION public.unipile_v2_shadow_prune()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '500ms'
AS $$
DECLARE
  endpoint record;
  removed_count bigint;
  removed_bytes bigint;
  total_removed bigint := 0;
BEGIN
  FOR endpoint IN SELECT id FROM unipile_v2_shadow.endpoints ORDER BY id FOR UPDATE LOOP
    WITH removed AS (
      DELETE FROM unipile_v2_shadow.events
      WHERE endpoint_id=endpoint.id AND expires_at < clock_timestamp()
      RETURNING octet_length(raw_body) AS bytes
    ) SELECT count(*),coalesce(sum(bytes),0) INTO removed_count,removed_bytes FROM removed;
    UPDATE unipile_v2_shadow.endpoints SET event_count=event_count-removed_count,
      total_bytes=total_bytes-removed_bytes WHERE id=endpoint.id;
    total_removed := total_removed+removed_count;
  END LOOP;
  RETURN total_removed;
END;
$$;
REVOKE ALL ON FUNCTION public.unipile_v2_shadow_accept(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unipile_v2_shadow_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unipile_v2_shadow_accept(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.unipile_v2_shadow_prune() TO service_role;
COMMIT;
