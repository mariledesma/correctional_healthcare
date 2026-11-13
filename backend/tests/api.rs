use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use correctional_healthcare_api::{AppState, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::time::{Duration, Instant};
use tower::ServiceExt;

async fn request(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer test-admin")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn seed(pool: &PgPool) {
    sqlx::query("INSERT INTO facility (facility_id,facility_name,state) VALUES ('f1','Test facility','TN'),('f2','No measurements','TN')").execute(pool).await.unwrap();
}

// These tests create and drop their own databases. Supply a disposable DATABASE_URL.
#[sqlx::test]
#[ignore = "requires disposable PostgreSQL DATABASE_URL"]
async fn crud_cache_and_risk_contract(pool: PgPool) {
    seed_auth(&pool).await;
    seed(&pool).await;
    let app = router(AppState::new(pool, Duration::from_secs(60)), vec![]);
    assert_eq!(
        request(&app, "GET", "/health", Value::Null).await.0,
        StatusCode::OK
    );
    let initial = request(&app, "GET", "/dashboard", Value::Null).await.1;
    assert!(initial["facility_risks"][0]["risk_pct"].is_null());
    assert_eq!(
        request(
            &app,
            "POST",
            "/compliance-checks",
            json!({"check_id":"c1","facility_id":"f1","violation_count":2})
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/compliance-checks",
            json!({"check_id":"c1","facility_id":"f1","violation_count":2})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let updated = request(&app, "GET", "/dashboard", Value::Null).await.1;
    assert_eq!(updated["compliance_checks"].as_array().unwrap().len(), 1);
    assert_eq!(updated["facility_risks"][0]["risk_pct"], 100.0);
    assert_eq!(
        request(
            &app,
            "PUT",
            "/compliance-checks/c1",
            json!({"facility_id":"f1","violation_count":0})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", "/facility-risks", Value::Null).await.1[0]["risk_pct"],
        0.0
    );
    assert_eq!(
        request(&app, "GET", "/facilities/f1/summary", Value::Null)
            .await
            .1["total_checks"],
        1
    );
    assert_eq!(
        request(&app, "GET", "/facilities/f1/compliance", Value::Null)
            .await
            .1[0]["check_id"],
        "c1"
    );
    assert_eq!(
        request(&app, "DELETE", "/compliance-checks/c1", Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    assert!(request(&app, "GET", "/facility-risks", Value::Null).await.1[0]["risk_pct"].is_null());
    assert_eq!(
        request(&app, "DELETE", "/compliance-checks/c1", Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, "GET", "/unknown", Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
}

#[sqlx::test]
#[ignore = "requires disposable PostgreSQL DATABASE_URL"]
async fn hospital_staffing_validation_and_latest_snapshot(pool: PgPool) {
    seed_auth(&pool).await;
    seed(&pool).await;
    let app = router(AppState::new(pool, Duration::from_secs(60)), vec![]);
    for (path, data) in [
        (
            "/hospital-utilization",
            json!({"visit_id":"h1","facility_id":"f1","length_of_stay_days":5,"estimated_cost_usd":"10.25"}),
        ),
        (
            "/hospital-utilization",
            json!({"visit_id":"h2","facility_id":"f1"}),
        ),
        (
            "/staffing-risk",
            json!({"staffing_record_id":"s1","facility_id":"f1","staff_category":"nurse","snapshot_date":"2025-01-01","target_staff_count":10,"vacancy_count":10}),
        ),
        (
            "/staffing-risk",
            json!({"staffing_record_id":"s2","facility_id":"f1","staff_category":"nurse","snapshot_date":"2026-01-01","target_staff_count":10,"actual_staff_count":10}),
        ),
        // Undated records must not displace the latest dated snapshot.
        (
            "/staffing-risk",
            json!({"staffing_record_id":"s3","facility_id":"f1","staff_category":"nurse","target_staff_count":10,"vacancy_count":10}),
        ),
    ] {
        assert_eq!(
            request(&app, "POST", path, data).await.0,
            StatusCode::CREATED
        );
    }
    let risk = request(&app, "GET", "/facility-risks", Value::Null).await.1;
    assert_eq!(risk[0]["hospital_risk_pct"], 100.0);
    assert_eq!(risk[0]["staffing_risk_pct"], 0.0);
    assert_eq!(risk[0]["staffing_records"], 3);
    assert_eq!(risk[0]["risk_pct"], 50.0);
    assert_eq!(
        request(
            &app,
            "GET",
            "/hospital-utilization?facility_id=f2",
            Value::Null
        )
        .await
        .1,
        json!([])
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            "/hospital-utilization/h1",
            json!({"reason_category":"test","estimated_cost_usd":null})
        )
        .await
        .0,
        StatusCode::OK
    );
    let h = request(&app, "GET", "/hospital-utilization/h1", Value::Null)
        .await
        .1;
    assert_eq!(h["length_of_stay_days"], 5);
    assert!(h["estimated_cost_usd"].is_null());
    for data in [
        json!({"facility_id":null}),
        json!({"length_of_stay_days":-1}),
        json!({"visit_date":"2026-02-30"}),
    ] {
        assert_eq!(
            request(&app, "PUT", "/hospital-utilization/h1", data)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        request(
            &app,
            "PUT",
            "/hospital-utilization/h1",
            json!({"facility_id":"missing"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(&app, "PUT", "/staffing-risk/s2", json!({"vacancy_count":3}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", "/facility-risks", Value::Null).await.1[0]["staffing_risk_pct"],
        100.0
    );
    assert_eq!(
        request(&app, "DELETE", "/hospital-utilization/h1", Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "DELETE", "/staffing-risk/s2", Value::Null)
            .await
            .0,
        StatusCode::OK
    );
}

#[sqlx::test]
#[ignore = "requires disposable PostgreSQL DATABASE_URL"]
async fn cache_expiry_and_concurrent_reads(pool: PgPool) {
    seed_auth(&pool).await;
    seed(&pool).await;
    let app = router(
        AppState::new(pool.clone(), Duration::from_millis(30)),
        vec![],
    );
    request(&app, "GET", "/dashboard", Value::Null).await;
    sqlx::query("UPDATE facility SET facility_name='Changed outside API' WHERE facility_id='f1'")
        .execute(&pool)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(40)).await;
    let mut tasks = vec![];
    for _ in 0..10 {
        let app = app.clone();
        tasks.push(tokio::spawn(async move {
            request(&app, "GET", "/dashboard", Value::Null).await
        }));
    }
    for task in tasks {
        let (status, data) = task.await.unwrap();
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            data["facilities"][0]["facility_name"],
            "Changed outside API"
        );
    }
}

#[sqlx::test]
#[ignore = "synthetic performance experiment; disposable PostgreSQL required"]
async fn benchmark_dashboard(pool: PgPool) {
    seed_auth(&pool).await;
    sqlx::raw_sql("INSERT INTO facility(facility_id,facility_name) SELECT 'f'||i,'Synthetic '||i FROM generate_series(1,500) i;
      INSERT INTO compliance_check SELECT 'c'||i,'f'||(1+(i%500)),i%4 FROM generate_series(1,10000) i;
      INSERT INTO hospital_utilization(visit_id,facility_id,length_of_stay_days) SELECT 'h'||i,'f'||(1+(i%500)),i%10 FROM generate_series(1,20000) i;
      INSERT INTO staffing_risk(staffing_record_id,facility_id,staff_category,snapshot_date,target_staff_count,actual_staff_count)
        SELECT 's'||i,'f'||(1+(i%500)),'nurse',DATE '2026-01-01'+(i/500),10,8 FROM generate_series(1,50000) i;
      ANALYZE;").execute(&pool).await.unwrap();
    let app = router(AppState::new(pool, Duration::from_secs(60)), vec![]);
    let start = Instant::now();
    assert_eq!(
        request(&app, "GET", "/dashboard", Value::Null).await.0,
        StatusCode::OK
    );
    let cold = start.elapsed();
    let mut warm = vec![];
    for _ in 0..30 {
        let start = Instant::now();
        assert_eq!(
            request(&app, "GET", "/dashboard", Value::Null).await.0,
            StatusCode::OK
        );
        warm.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    warm.sort_by(f64::total_cmp);
    println!(
        "SYNTHETIC dashboard: cold={:.2}ms warm_p50={:.2}ms warm_p95={:.2}ms (500 facilities, 10k compliance, 20k visits, 50k staffing; in-process HTTP, debug build)",
        cold.as_secs_f64() * 1000.0,
        warm[15],
        warm[28]
    );
}

async fn seed_auth(pool: &PgPool) {
    sqlx::query("INSERT INTO app_user(id,username,password_hash,role) VALUES('test-admin','test-admin','unused','admin')").execute(pool).await.unwrap();
    sqlx::query("INSERT INTO login_session(token_hash,user_id,expires_at) VALUES($1,'test-admin',now()+interval '1 hour')").bind(correctional_healthcare_api::auth::digest("test-admin")).execute(pool).await.unwrap();
}
