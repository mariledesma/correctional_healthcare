-- Preserve the complete legacy course dataset when initializing a new database.
ALTER TABLE facility
 ADD COLUMN IF NOT EXISTS facility_type text,
 ADD COLUMN IF NOT EXISTS status text,
 ADD COLUMN IF NOT EXISTS address text,
 ADD COLUMN IF NOT EXISTS city text,
 ADD COLUMN IF NOT EXISTS zip text,
 ADD COLUMN IF NOT EXISTS population integer,
 ADD COLUMN IF NOT EXISTS capacity integer,
 ADD COLUMN IF NOT EXISTS security_level text,
 ADD COLUMN IF NOT EXISTS source_website text;
ALTER TABLE compliance_check
 ADD COLUMN IF NOT EXISTS check_date date,
 ADD COLUMN IF NOT EXISTS compliance_category text,
 ADD COLUMN IF NOT EXISTS check_status text,
 ADD COLUMN IF NOT EXISTS corrective_action_status text,
 ADD COLUMN IF NOT EXISTS resolution_date date,
 ADD COLUMN IF NOT EXISTS data_type text;
-- The source coordinates are doubles. Avoid rounding them during import into a
-- database initialized by the old minimal schema. Location is a derived column;
-- --enable-postgis recreates it and its GiST index after the migration.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
     AND table_name='facility' AND column_name IN ('latitude','longitude') AND data_type<>'double precision') THEN
   ALTER TABLE facility DROP COLUMN IF EXISTS location;
   ALTER TABLE facility ALTER COLUMN latitude TYPE double precision USING latitude::double precision;
   ALTER TABLE facility ALTER COLUMN longitude TYPE double precision USING longitude::double precision;
 END IF;
END $$;
