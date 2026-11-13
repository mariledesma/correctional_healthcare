-- Compatible with the original SQLAlchemy tables; existing records are preserved.
CREATE TABLE IF NOT EXISTS facility (
    facility_id text PRIMARY KEY, facility_name text, county text, state text,
    latitude numeric(10,8), longitude numeric(11,8)
);
CREATE TABLE IF NOT EXISTS compliance_check (
    check_id text PRIMARY KEY, facility_id text REFERENCES facility(facility_id), violation_count integer
);
CREATE TABLE IF NOT EXISTS hospital_utilization (
    visit_id text PRIMARY KEY, facility_id text NOT NULL REFERENCES facility(facility_id),
    visit_date date, service_type text, reason_category text, length_of_stay_days integer,
    estimated_cost_usd numeric(12,2), transfer_outcome text, data_type text
);
CREATE TABLE IF NOT EXISTS staffing_risk (
    staffing_record_id text PRIMARY KEY, facility_id text NOT NULL REFERENCES facility(facility_id),
    snapshot_date date, staff_category text, target_staff_count integer, actual_staff_count integer,
    vacancy_count integer, overtime_hours_monthly integer, staffing_shortage_flag text, data_type text
);
