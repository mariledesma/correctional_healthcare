use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use correctional_healthcare_api::{AppState, auth, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::time::Duration;
use tower::ServiceExt;
async fn call(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("Content-Type", "application/json");
    if let Some(t) = token {
        builder = builder.header("Authorization", format!("Bearer {t}"));
    }
    let result = app
        .clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = result.status();
    let bytes = result.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn admin(pool: &PgPool) -> (Router, String) {
    auth::bootstrap(pool, "admin", "test-Password-1234".into())
        .await
        .unwrap();
    let app = router(AppState::new(pool.clone(), Duration::from_secs(60)), vec![]);
    let (status, result) = call(
        &app,
        "POST",
        "/auth/login",
        None,
        json!({"username":"admin","password":"test-Password-1234"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (app, result["access_token"].as_str().unwrap().to_owned())
}
#[sqlx::test]
#[ignore = "disposable PostgreSQL required"]
async fn accounts_authorization_revocation_and_audit(pool: PgPool) {
    let (app, token) = admin(&pool).await;
    for path in [
        "/dashboard",
        "/facilities",
        "/facility-risks",
        "/hospital-utilization",
        "/audit-logs",
        "/facilities-nearby?latitude=0&longitude=0",
    ] {
        assert_eq!(
            call(&app, "GET", path, None, Value::Null).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    sqlx::query("INSERT INTO facility(facility_id,facility_name) VALUES('f1','Demo')")
        .execute(&pool)
        .await
        .unwrap();
    let (status, user) = call(
        &app,
        "POST",
        "/auth/users",
        Some(&token),
        json!({"username":"reader","password":"reader-Password-1234","role":"viewer"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(user.get("password_hash").is_none());
    let viewer = call(
        &app,
        "POST",
        "/auth/login",
        None,
        json!({"username":"reader","password":"reader-Password-1234"}),
    )
    .await
    .1["access_token"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        call(&app, "GET", "/dashboard", Some(&viewer), Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    let record = json!({"check_id":"c1","facility_id":"f1","violation_count":1});
    assert_eq!(
        call(
            &app,
            "POST",
            "/compliance-checks",
            Some(&viewer),
            record.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "GET", "/audit-logs", Some(&viewer), Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "GET", "/auth/users", Some(&viewer), Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "POST", "/compliance-checks", Some(&token), record)
            .await
            .0,
        StatusCode::CREATED
    );
    let rows = call(&app, "GET", "/audit-logs", Some(&token), Value::Null)
        .await
        .1;
    let audit = rows
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["table_name"] == "compliance_check")
        .unwrap();
    assert_eq!(audit["operation"], "INSERT");
    assert_eq!(audit["new_data"]["check_id"], "c1");
    assert!(!audit["actor_id"].is_null());
    assert!(!rows.to_string().contains("password_hash"));
    assert!(!rows.to_string().contains("test-Password"));
    assert!(
        sqlx::query("DELETE FROM audit_log")
            .execute(&pool)
            .await
            .is_err()
    );
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("UPDATE compliance_check SET violation_count=20")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, after);
    // Promotion revokes existing sessions. A new editor login allows updates but not deletes or account management.
    let path = format!("/auth/users/{}", user["id"].as_str().unwrap());
    assert_eq!(
        call(
            &app,
            "PATCH",
            &path,
            Some(&token),
            json!({"role":"editor","active":true})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "GET", "/dashboard", Some(&viewer), Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let editor = call(
        &app,
        "POST",
        "/auth/login",
        None,
        json!({"username":"reader","password":"reader-Password-1234"}),
    )
    .await
    .1["access_token"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        call(
            &app,
            "PUT",
            "/compliance-checks/c1",
            Some(&editor),
            json!({"facility_id":"f1","violation_count":0})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            "/compliance-checks/c1",
            Some(&editor),
            Value::Null
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/auth/users",
            Some(&editor),
            json!({"username":"attacker","password":"reader-Password-1234","role":"admin"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "POST", "/auth/logout", Some(&editor), Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "GET", "/auth/me", Some(&editor), Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert!(
        auth::bootstrap(&pool, "another", "another-password".into())
            .await
            .is_err()
    );
}
#[sqlx::test]
#[ignore = "disposable PostgreSQL required"]
async fn password_change_expiry_and_login_throttle(pool: PgPool) {
    let (app, token) = admin(&pool).await;
    assert_eq!(
        call(
            &app,
            "POST",
            "/auth/password",
            Some(&token),
            json!({"current_password":"wrong","new_password":"new-Password-5678"})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(&app, "GET", "/auth/me", Some(&token), Value::Null)
            .await
            .0,
        StatusCode::OK
    );

    assert_eq!(
        call(
            &app,
            "POST",
            "/auth/password",
            Some(&token),
            json!({"current_password":"test-Password-1234","new_password":"new-Password-5678"})
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "GET", "/auth/me", Some(&token), Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let result = call(
        &app,
        "POST",
        "/auth/login",
        None,
        json!({"username":"admin","password":"new-Password-5678"}),
    )
    .await;
    assert_eq!(result.0, StatusCode::OK);
    let token = result.1["access_token"].as_str().unwrap();
    sqlx::query("UPDATE login_session SET expires_at=now()-interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", "/auth/me", Some(token), Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    for _ in 0..5 {
        assert_eq!(
            call(
                &app,
                "POST",
                "/auth/login",
                None,
                json!({"username":"admin","password":"wrong"})
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        call(
            &app,
            "POST",
            "/auth/login",
            None,
            json!({"username":"admin","password":"new-Password-5678"})
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
}
#[sqlx::test]
#[ignore = "PostGIS-capable disposable PostgreSQL required"]
async fn spatial_and_risk_explanations(pool: PgPool) {
    let (app, token) = admin(&pool).await;
    assert_eq!(
        call(
            &app,
            "GET",
            "/facilities-nearby?latitude=0&longitude=0",
            Some(&token),
            Value::Null
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    sqlx::raw_sql(include_str!("../sql/postgis.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO facility(facility_id,facility_name,latitude,longitude) VALUES('near','Nearby',36,-86),('far','Distant',40,-100),('unknown','Unknown',NULL,NULL)").execute(&pool).await.unwrap();
    let response = call(
        &app,
        "GET",
        "/facilities-nearby?latitude=36&longitude=-86&radius_km=10",
        Some(&token),
        Value::Null,
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);
    assert_eq!(response.1.as_array().unwrap().len(), 1);
    assert_eq!(response.1[0]["facility_id"], "near");
    assert_eq!(
        call(
            &app,
            "GET",
            "/facilities-nearby?latitude=91&longitude=0",
            Some(&token),
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let analysis = call(
        &app,
        "GET",
        "/risk-analysis/near",
        Some(&token),
        Value::Null,
    )
    .await;
    assert_eq!(analysis.0, StatusCode::OK);
    assert!(analysis.1["risk"]["risk_pct"].is_null());
    assert_eq!(analysis.1["hospital_monthly"], json!([]));
    sqlx::query("UPDATE facility SET latitude=40,longitude=-100 WHERE facility_id='near'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            "/facilities-nearby?latitude=36&longitude=-86&radius_km=10",
            Some(&token),
            Value::Null
        )
        .await
        .1,
        json!([])
    );
}
#[sqlx::test]
#[ignore = "PostgreSQL and TEST_REDIS_URL required"]
async fn redis_sharing_revision_and_fallback(pool: PgPool) {
    let (_, token) = admin(&pool).await;
    let redis_url =
        std::env::var("TEST_REDIS_URL").expect("Set TEST_REDIS_URL for the Redis integration test");
    let first = router(
        AppState::new(pool.clone(), Duration::from_secs(60))
            .with_redis(Some(&redis_url))
            .unwrap(),
        vec![],
    );
    let second = router(
        AppState::new(pool.clone(), Duration::from_secs(60))
            .with_redis(Some(&redis_url))
            .unwrap(),
        vec![],
    );
    sqlx::query("INSERT INTO facility(facility_id,facility_name) VALUES('f1','Before')")
        .execute(&pool)
        .await
        .unwrap();
    let initial = call(&first, "GET", "/dashboard", Some(&token), Value::Null)
        .await
        .1;
    assert_eq!(
        initial,
        call(&second, "GET", "/dashboard", Some(&token), Value::Null)
            .await
            .1
    );
    let (version, namespace): (i64, String) =
        sqlx::query_as("SELECT version,namespace FROM data_revision WHERE id=1")
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut conn = redis::Client::open(redis_url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let exists: bool = redis::cmd("EXISTS")
        .arg(format!("healthcare:{namespace}:dashboard:v2:{version}"))
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(exists);
    sqlx::query("UPDATE facility SET facility_name='After' WHERE facility_id='f1'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&second, "GET", "/dashboard", Some(&token), Value::Null)
            .await
            .1["facilities"][0]["facility_name"],
        "After"
    );
    let fallback = router(
        AppState::new(pool, Duration::from_secs(60))
            .with_redis(Some("redis://127.0.0.1:1/"))
            .unwrap(),
        vec![],
    );
    assert_eq!(
        call(&fallback, "GET", "/dashboard", Some(&token), Value::Null)
            .await
            .0,
        StatusCode::OK
    );
}

#[sqlx::test]
#[ignore = "disposable PostgreSQL required"]
async fn restricted_database_role_cannot_mutate_audit(pool: PgPool) {
    sqlx::raw_sql(include_str!("../sql/runtime_role.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE healthcare_runtime")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("SELECT set_config('app.actor_id','role-test',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO facility(facility_id) VALUES('runtime-created')")
        .execute(&mut *tx)
        .await
        .unwrap();
    let actor: String =
        sqlx::query_scalar("SELECT actor_id FROM audit_log WHERE record_id='runtime-created'")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(actor, "role-test");
    tx.commit().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE healthcare_runtime")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(
        sqlx::query("DELETE FROM audit_log")
            .execute(&mut *tx)
            .await
            .is_err()
    );
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE healthcare_runtime")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(
        sqlx::query("ALTER TABLE audit_log DISABLE TRIGGER ALL")
            .execute(&mut *tx)
            .await
            .is_err()
    );
    tx.rollback().await.unwrap();
}
