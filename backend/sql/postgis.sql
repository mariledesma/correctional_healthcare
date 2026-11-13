BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE facility ADD COLUMN IF NOT EXISTS location geography(Point,4326)
GENERATED ALWAYS AS (
 CASE WHEN latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
 THEN ST_SetSRID(ST_MakePoint(longitude::double precision,latitude::double precision),4326)::geography END
) STORED;
CREATE INDEX IF NOT EXISTS facility_location_gist ON facility USING gist(location);
COMMIT;
