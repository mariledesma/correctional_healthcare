-- Run with the migration-owner connection after migrations. Never run the API as
-- the migration owner in a hosted deployment. Assign a password out of band:
-- in psql: \password healthcare_runtime
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='healthcare_runtime') THEN
   CREATE ROLE healthcare_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO healthcare_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON facility,compliance_check,hospital_utilization,staffing_risk,
 app_user,login_session,login_throttle TO healthcare_runtime;
GRANT SELECT,INSERT ON audit_log TO healthcare_runtime;
GRANT USAGE,SELECT ON SEQUENCE audit_log_id_seq TO healthcare_runtime;
GRANT SELECT ON data_revision TO healthcare_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON audit_log FROM healthcare_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
