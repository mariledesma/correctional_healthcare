use crate::{
    AppState,
    error::{ApiError, ApiResult},
};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};

// SQL identifiers only come from this compile-time allowlist, never request data.
struct Resource {
    table: &'static str,
    id: &'static str,
    fields: &'static [&'static str],
    order: &'static str,
}
fn resource(name: &str) -> ApiResult<Resource> {
    Ok(match name {
        "compliance-checks" => Resource {
            table: "compliance_check",
            id: "check_id",
            fields: &["facility_id", "violation_count"],
            order: "check_id",
        },
        "hospital-utilization" => Resource {
            table: "hospital_utilization",
            id: "visit_id",
            fields: &[
                "facility_id",
                "visit_date",
                "service_type",
                "reason_category",
                "length_of_stay_days",
                "estimated_cost_usd",
                "transfer_outcome",
                "data_type",
            ],
            order: "visit_date DESC, visit_id",
        },
        "staffing-risk" => Resource {
            table: "staffing_risk",
            id: "staffing_record_id",
            fields: &[
                "facility_id",
                "snapshot_date",
                "staff_category",
                "target_staff_count",
                "actual_staff_count",
                "vacancy_count",
                "overtime_hours_monthly",
                "staffing_shortage_flag",
                "data_type",
            ],
            order: "snapshot_date DESC, staffing_record_id",
        },
        _ => return Err(ApiError::missing()),
    })
}
fn validate(r: &Resource, data: &Value, create: bool) -> ApiResult<()> {
    let object = data
        .as_object()
        .ok_or_else(|| ApiError::invalid("Expected a JSON object"))?;
    if create {
        for name in [r.id, "facility_id"] {
            if data[name].as_str().is_none_or(|v| v.trim().is_empty()) {
                return Err(ApiError::invalid(format!("{name} is required")));
            }
        }
    }
    if r.table == "compliance_check" {
        for name in ["facility_id", "violation_count"] {
            if data.get(name).is_none_or(Value::is_null) {
                return Err(ApiError::invalid(format!("{name} is required")));
            }
        }
    }
    for (key, value) in object {
        if !(r.fields.contains(&key.as_str()) || create && key == r.id) {
            return Err(ApiError::invalid(format!(
                "Unknown or immutable field: {key}"
            )));
        }
        if key == "facility_id" || key == r.id {
            if value
                .as_str()
                .is_none_or(|v| v.trim().is_empty() || v.len() > 200)
            {
                return Err(ApiError::invalid(format!("{key} must be a nonempty ID")));
            }
        } else if !value.is_null() {
            if [
                "violation_count",
                "length_of_stay_days",
                "target_staff_count",
                "actual_staff_count",
                "vacancy_count",
                "overtime_hours_monthly",
            ]
            .contains(&key.as_str())
            {
                if value
                    .as_i64()
                    .is_none_or(|v| !(0..=i32::MAX as i64).contains(&v))
                {
                    return Err(ApiError::invalid(format!(
                        "{key} must be a nonnegative integer"
                    )));
                }
            } else if key == "estimated_cost_usd" {
                // Accept decimal strings as well as JSON numbers, like the previous API.
                let amount = value
                    .as_f64()
                    .or_else(|| value.as_str().and_then(|v| v.parse::<f64>().ok()));
                if amount.is_none_or(|v| !v.is_finite() || !(0.0..=9_999_999_999.99).contains(&v)) {
                    return Err(ApiError::invalid("Invalid estimated_cost_usd"));
                }
            } else if key.ends_with("_date") {
                if value
                    .as_str()
                    .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
                    .is_none()
                {
                    return Err(ApiError::invalid(format!(
                        "{key} must be a valid YYYY-MM-DD date"
                    )));
                }
            } else if value.as_str().is_none_or(|v| v.len() > 4000) {
                return Err(ApiError::invalid(format!(
                    "{key} must be text (maximum 4000 characters)"
                )));
            }
        }
    }
    Ok(())
}
#[derive(Deserialize)]
pub struct Filter {
    facility_id: Option<String>,
}
pub async fn list(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(filter): Query<Filter>,
) -> ApiResult<Json<Value>> {
    let r = resource(&name)?;
    let sql = format!(
        "SELECT to_jsonb(t) FROM {} t WHERE ($1::text IS NULL OR facility_id=$1) ORDER BY {}",
        r.table, r.order
    );
    let rows: Vec<Value> = sqlx::query_scalar(&sql)
        .bind(filter.facility_id)
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(json!(rows)))
}
pub async fn get_record(
    State(state): State<AppState>,
    Path((name, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let r = resource(&name)?;
    let sql = format!("SELECT to_jsonb(t) FROM {} t WHERE {}=$1", r.table, r.id);
    let row = sqlx::query_scalar(&sql)
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(ApiError::missing)?;
    Ok(Json(row))
}
pub async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<crate::auth::User>,
    Path(name): Path<String>,
    Json(data): Json<Value>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let r = resource(&name)?;
    let mut tx = crate::auth::transaction(&state.pool, &actor.id).await?;
    validate(&r, &data, true)?;
    let columns = std::iter::once(r.id)
        .chain(r.fields.iter().copied())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT INTO {} ({columns}) SELECT {columns} FROM jsonb_populate_record(NULL::{}, $1) RETURNING to_jsonb({})",
        r.table, r.table, r.table
    );
    let row = sqlx::query_scalar(&sql)
        .bind(data)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    state.invalidate().await;
    Ok((StatusCode::CREATED, Json(row)))
}
pub async fn update(
    State(state): State<AppState>,
    Extension(actor): Extension<crate::auth::User>,
    Path((name, id)): Path<(String, String)>,
    Json(data): Json<Value>,
) -> ApiResult<Json<Value>> {
    let r = resource(&name)?;
    let mut tx = crate::auth::transaction(&state.pool, &actor.id).await?;
    validate(&r, &data, false)?;
    let columns = r.fields.join(", ");
    let sql = format!(
        "UPDATE {} t SET ({columns}) = (SELECT {columns} FROM jsonb_populate_record(NULL::{}, to_jsonb(t) || $1)) WHERE {}=$2 RETURNING to_jsonb(t)",
        r.table, r.table, r.id
    );
    let row = sqlx::query_scalar(&sql)
        .bind(data)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::missing)?;
    tx.commit().await?;
    state.invalidate().await;
    Ok(Json(row))
}
pub async fn delete(
    State(state): State<AppState>,
    Extension(actor): Extension<crate::auth::User>,
    Path((name, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let r = resource(&name)?;
    let mut tx = crate::auth::transaction(&state.pool, &actor.id).await?;
    let sql = format!("DELETE FROM {} WHERE {}=$1", r.table, r.id);
    if sqlx::query(&sql)
        .bind(&id)
        .execute(&mut *tx)
        .await?
        .rows_affected()
        == 0
    {
        return Err(ApiError::missing());
    }
    tx.commit().await?;
    state.invalidate().await;
    Ok(Json(json!({"message": "Record deleted", r.id: id})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_ids_numbers_dates_and_unknown_fields() {
        let r = resource("hospital-utilization").unwrap_or_else(|_| panic!());
        for data in [
            json!({"facility_id":null}),
            json!({"length_of_stay_days":-1}),
            json!({"visit_date":"2026-02-30"}),
            json!({"evil":1}),
            json!({"visit_id":"immutable"}),
        ] {
            assert!(validate(&r, &data, false).is_err());
        }
        assert!(
            validate(
                &r,
                &json!({"estimated_cost_usd":"12.34", "visit_date":null}),
                false
            )
            .is_ok()
        );
    }
    #[test]
    fn identifiers_are_allowlisted() {
        assert!(resource("facility; DROP TABLE facility").is_err());
    }
}
