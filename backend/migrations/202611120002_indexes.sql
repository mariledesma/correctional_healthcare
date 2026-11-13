CREATE INDEX IF NOT EXISTS compliance_facility_idx ON compliance_check (facility_id);
CREATE INDEX IF NOT EXISTS hospital_facility_date_idx ON hospital_utilization (facility_id, visit_date DESC, visit_id);
CREATE INDEX IF NOT EXISTS staffing_facility_date_idx ON staffing_risk (facility_id, snapshot_date DESC, staffing_record_id);
CREATE INDEX IF NOT EXISTS staffing_latest_category_idx ON staffing_risk
    (facility_id, staff_category, snapshot_date DESC NULLS LAST, staffing_record_id DESC)
    INCLUDE (target_staff_count, actual_staff_count, vacancy_count, staffing_shortage_flag);
CREATE INDEX IF NOT EXISTS facility_state_county_idx ON facility (state, county);
