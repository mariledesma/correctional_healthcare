WITH compliance AS (
  SELECT facility_id, count(*) AS checks,
    count(*) FILTER (WHERE violation_count > 0) AS flagged,
    coalesce(sum(violation_count), 0) AS violations
  FROM compliance_check GROUP BY facility_id
), hospital AS (
  SELECT facility_id, count(*) AS visits, count(length_of_stay_days) AS measured,
    count(*) FILTER (WHERE length_of_stay_days >= 5) AS long_stays
  FROM hospital_utilization GROUP BY facility_id
), staffing_counts AS (
  SELECT facility_id, count(*) AS records FROM staffing_risk GROUP BY facility_id
), latest AS (
  SELECT DISTINCT ON (facility_id, staff_category) facility_id, staff_category,
    target_staff_count AS target,
    CASE WHEN target_staff_count > 0 THEN
      greatest(0, least(target_staff_count, coalesce(vacancy_count,
        CASE WHEN actual_staff_count IS NOT NULL THEN greatest(0, target_staff_count - actual_staff_count) END)))
    END AS vacancy,
    (vacancy_count IS NOT NULL OR actual_staff_count IS NOT NULL) AS measured,
    lower(trim(coalesce(staffing_shortage_flag,''))) IN ('yes','true','1','y') AS shortage
  FROM staffing_risk
  ORDER BY facility_id, staff_category, snapshot_date DESC NULLS LAST, staffing_record_id DESC
), staffing AS (
  SELECT facility_id,
    coalesce(sum(target) FILTER (WHERE target > 0 AND measured),0) AS target,
    coalesce(sum(vacancy) FILTER (WHERE target > 0 AND measured),0) AS vacancies,
    bool_or(shortage OR (target > 0 AND measured AND vacancy > 0)) AS shortage
  FROM latest GROUP BY facility_id
)
SELECT jsonb_build_object(
 'facility_id', f.facility_id, 'facility_name', f.facility_name,
 'compliance_checks', coalesce(c.checks,0), 'total_violations', coalesce(c.violations,0),
 'flagged', coalesce(c.flagged,0), 'hospital_visits', coalesce(h.visits,0),
 'measured', coalesce(h.measured,0), 'long_stays', coalesce(h.long_stays,0),
 'staffing_records', coalesce(sc.records,0), 'staffing_vacancies', coalesce(s.vacancies,0),
 'target', coalesce(s.target,0), 'has_staffing_shortage', coalesce(s.shortage,false)
)
FROM facility f
LEFT JOIN compliance c USING (facility_id)
LEFT JOIN hospital h USING (facility_id)
LEFT JOIN staffing_counts sc USING (facility_id)
LEFT JOIN staffing s USING (facility_id)
ORDER BY f.facility_id
