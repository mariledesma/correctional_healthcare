# Performance verification

The original dashboard made three requests. Its risk endpoint retrieved all staffing
history, sorted it, and selected one latest row per category in Python. The Rust
version uses one dashboard request, PostgreSQL aggregates and latest-row selection,
a connection pool, response compression, and an invalidated TTL cache.

No timing of the user's live database has been taken. A language migration alone
cannot establish or guarantee an improvement in real dashboard latency. Connection
latency, table sizes, query plans, and response payload sizes still matter.

## Repeatable synthetic benchmark

Run the ignored `benchmark_dashboard` integration test with a disposable PostgreSQL
connection. It seeds 500 facilities, 10,000 compliance checks, 20,000 hospital visits,
and 50,000 staffing snapshots. It measures one cold request and 30 warm requests,
including in-process HTTP routing and JSON serialization/parsing. It does not include
network latency, browser rendering, TLS, or production workload concurrency.

## Inspect the SQL plan

Run on a development copy of your data, after migrations and `ANALYZE`:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT DISTINCT ON (facility_id, staff_category)
    facility_id, staff_category, snapshot_date,
    target_staff_count, actual_staff_count, vacancy_count, staffing_shortage_flag
FROM staffing_risk
ORDER BY facility_id, staff_category,
    snapshot_date DESC NULLS LAST, staffing_record_id DESC;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM hospital_utilization
WHERE facility_id = 'YOUR_FACILITY_ID'
ORDER BY visit_date DESC, visit_id;
```

For the complete risk query, prepend `EXPLAIN (ANALYZE, BUFFERS)` to
`backend/src/risk.sql`. PostgreSQL may correctly choose sequential scans for
whole-table aggregates or small tables. Compare execution time, rows, buffer reads,
and sorting; the existence of an index alone does not prove it improves a query.

## Observed result (November 12, 2026)

On the isolated local PostgreSQL instance, with the fixture above and a Rust debug
build, the final implementation measured:

| Measurement | Time |
|---|---:|
| First uncached dashboard request | 422.36 ms |
| Cached request median (30 requests) | 75.14 ms |
| Cached request p95 (30 requests) | 77.08 ms |

These numbers include parsing the returned JSON in the test client. They compare
cold and warm requests in the new implementation, **not Python versus Rust**, and
are not measurements of the user's live dashboard. Runtime and database cache state
can change these results. The release build and a browser/network trace should be
measured separately when connecting the migrated app to the real database.

## Authenticated implementation with audit triggers

After adding authentication, revision checks, and auditing, the same fixture measured
601.80 ms cold, 93.04 ms cached median, and 148.75 ms cached p95 in one local debug-build
run. Authentication and cache revision validation still query PostgreSQL on cache hits.
These figures are synthetic, not live-application guarantees or a Python comparison.
The benchmark includes routing and parsing the JSON response. Its setup also inserts
audit rows; setup time is excluded from request latency.

Additional integration coverage checks cross-process Redis reuse, direct-SQL revision
invalidation, and fallback when Redis is unavailable. Indexes are applied through
versioned migrations; spatial points have a separate GiST index when enabled.
