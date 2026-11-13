use crate::{
    AppState,
    auth::User,
    error::{ApiError, ApiResult},
};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Deserialize)]
pub struct AuditQuery {
    before: Option<i64>,
    limit: Option<i64>,
    actor_id: Option<String>,
}
pub async fn audit(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(q): Query<AuditQuery>,
) -> ApiResult<Json<Value>> {
    if user.role != "admin" {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Administrator access required".into(),
        ));
    }
    let limit = q.limit.unwrap_or(50);
    if !(1..=200).contains(&limit) {
        return Err(ApiError::invalid("Limit must be 1–200"));
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(a) FROM audit_log a WHERE ($1::bigint IS NULL OR id<$1) AND ($2::text IS NULL OR actor_id=$2) ORDER BY id DESC LIMIT $3").bind(q.before).bind(q.actor_id).bind(limit).fetch_all(&state.pool).await?;
    Ok(Json(json!(rows)))
}
#[derive(Deserialize)]
pub struct NearbyQuery {
    latitude: f64,
    longitude: f64,
    radius_km: Option<f64>,
    limit: Option<i64>,
}
pub async fn nearby(
    State(state): State<AppState>,
    Query(q): Query<NearbyQuery>,
) -> ApiResult<Json<Value>> {
    let radius = q.radius_km.unwrap_or(25.0);
    let limit = q.limit.unwrap_or(100);
    if !q.latitude.is_finite()
        || !q.longitude.is_finite()
        || !radius.is_finite()
        || !(-90.0..=90.0).contains(&q.latitude)
        || !(-180.0..=180.0).contains(&q.longitude)
        || radius <= 0.0
        || radius > 500.0
        || !(1..=500).contains(&limit)
    {
        return Err(ApiError::invalid(
            "Invalid coordinates, radius (0–500 km), or limit (1–500)",
        ));
    }
    let enabled:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='facility' AND column_name='location' AND table_schema='public')").fetch_one(&state.pool).await?;
    if !enabled {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Spatial search is not enabled. Run --enable-postgis.".into(),
        ));
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) FROM (SELECT facility_id,facility_name,latitude,longitude,ST_Distance(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)/1000 AS distance_km FROM facility WHERE ST_DWithin(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$3) ORDER BY distance_km,facility_id LIMIT $4) t")
 .bind(q.longitude).bind(q.latitude).bind(radius*1000.0).bind(limit).fetch_all(&state.pool).await?;
    Ok(Json(json!(rows)))
}
pub async fn analysis(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let dashboard = state.dashboard().await?;
    let risk = dashboard.value["facility_risks"]
        .as_array()
        .and_then(|rows| rows.iter().find(|r| r["facility_id"].as_str() == Some(&id)))
        .cloned()
        .ok_or_else(ApiError::missing)?;
    let monthly:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('month',to_char(visit_date,'YYYY-MM'),'visits',count(*),'measured_stays',count(length_of_stay_days),'long_stays',count(*) FILTER(WHERE length_of_stay_days>=5),'known_cost_usd',coalesce(sum(estimated_cost_usd),0),'cost_records',count(estimated_cost_usd)) FROM hospital_utilization WHERE facility_id=$1 AND visit_date IS NOT NULL GROUP BY to_char(visit_date,'YYYY-MM') ORDER BY to_char(visit_date,'YYYY-MM') DESC LIMIT 12").bind(&id).fetch_all(&state.pool).await?;
    let staffing:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(t) FROM (SELECT DISTINCT ON(staff_category) staff_category,snapshot_date,target_staff_count,actual_staff_count,vacancy_count FROM staffing_risk WHERE facility_id=$1 ORDER BY staff_category,snapshot_date DESC NULLS LAST,staffing_record_id DESC) t").bind(&id).fetch_all(&state.pool).await?;
    Ok(Json(
        json!({"risk":risk,"hospital_monthly":monthly,"latest_staffing":staffing,"limitations":["Operational demonstration, not a clinical prediction.","The composite uses all compliance records; compliance trends are not included in this view.","Hospital trend includes only dated visits; cost totals exclude unknown costs.","Latest staffing snapshots may come from different dates."]}),
    ))
}
