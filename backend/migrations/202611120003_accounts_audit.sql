CREATE TABLE app_user (
 id text PRIMARY KEY, username text UNIQUE NOT NULL CHECK (username = lower(username)),
 password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('viewer','editor','admin')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE login_session (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_session_user_idx ON login_session(user_id);
CREATE INDEX login_session_expiry_idx ON login_session(expires_at);
CREATE TABLE login_throttle (
 username text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id text, database_user text NOT NULL DEFAULT session_user, table_name text NOT NULL,
 operation text NOT NULL, record_id text, old_data jsonb, new_data jsonb
);
CREATE INDEX audit_time_idx ON audit_log (id DESC);
CREATE INDEX audit_actor_idx ON audit_log (actor_id, id DESC);
CREATE TABLE data_revision (id integer PRIMARY KEY CHECK(id=1), version bigint NOT NULL DEFAULT 0, namespace text NOT NULL);
INSERT INTO data_revision VALUES (1,0,md5(random()::text || clock_timestamp()::text));

CREATE FUNCTION audit_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE old_row jsonb; new_row jsonb; key_name text;
BEGIN
 old_row := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'password_hash' ELSE NULL END;
 new_row := CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) - 'password_hash' ELSE NULL END;
 key_name := TG_ARGV[0];
 INSERT INTO public.audit_log(actor_id,table_name,operation,record_id,old_data,new_data)
 VALUES(nullif(current_setting('app.actor_id',true),''),TG_TABLE_NAME,TG_OP,
        coalesce(new_row->>key_name,old_row->>key_name),old_row,new_row);
 RETURN NULL;
END $$;
CREATE FUNCTION bump_data_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
 UPDATE public.data_revision SET version=version+1 WHERE id=1;
 RETURN NULL;
END $$;
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER facility_audit AFTER INSERT OR UPDATE OR DELETE ON facility FOR EACH ROW EXECUTE FUNCTION audit_changes('facility_id');
CREATE TRIGGER compliance_audit AFTER INSERT OR UPDATE OR DELETE ON compliance_check FOR EACH ROW EXECUTE FUNCTION audit_changes('check_id');
CREATE TRIGGER hospital_audit AFTER INSERT OR UPDATE OR DELETE ON hospital_utilization FOR EACH ROW EXECUTE FUNCTION audit_changes('visit_id');
CREATE TRIGGER staffing_audit AFTER INSERT OR UPDATE OR DELETE ON staffing_risk FOR EACH ROW EXECUTE FUNCTION audit_changes('staffing_record_id');
CREATE TRIGGER user_audit AFTER INSERT OR UPDATE OR DELETE ON app_user FOR EACH ROW EXECUTE FUNCTION audit_changes('id');
CREATE TRIGGER facility_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON facility FOR EACH STATEMENT EXECUTE FUNCTION bump_data_revision();
CREATE TRIGGER compliance_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON compliance_check FOR EACH STATEMENT EXECUTE FUNCTION bump_data_revision();
CREATE TRIGGER hospital_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON hospital_utilization FOR EACH STATEMENT EXECUTE FUNCTION bump_data_revision();
CREATE TRIGGER staffing_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON staffing_risk FOR EACH STATEMENT EXECUTE FUNCTION bump_data_revision();
REVOKE ALL ON audit_log, data_revision FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_changes(), bump_data_revision(), reject_audit_mutation() FROM PUBLIC;
