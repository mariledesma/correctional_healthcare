pub mod auth;
mod error;
mod extensions;
mod records;
mod risk;
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::get,
};
use error::{ApiError, ApiResult};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};

struct DashboardPayload {
    value: Value,
    encoded: Bytes,
}

struct CachedDashboard {
    generation: u64,
    revision: i64,
    created: Instant,
    value: Arc<DashboardPayload>,
}
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    cache: Arc<RwLock<Option<CachedDashboard>>>,
    refresh: Arc<Mutex<()>>,
    generation: Arc<AtomicU64>,
    ttl: Duration,
    redis: Option<redis::Client>,
}
impl AppState {
    pub fn new(pool: PgPool, ttl: Duration) -> Self {
        Self {
            pool,
            cache: Arc::new(RwLock::new(None)),
            refresh: Arc::new(Mutex::new(())),
            generation: Arc::new(AtomicU64::new(0)),
            ttl,
            redis: None,
        }
    }
    pub fn with_redis(mut self, url: Option<&str>) -> Result<Self, redis::RedisError> {
        self.redis = url.map(redis::Client::open).transpose()?;
        Ok(self)
    }
    async fn revision(&self) -> ApiResult<(i64, String)> {
        Ok(
            sqlx::query_as("SELECT version, namespace FROM data_revision WHERE id=1")
                .fetch_one(&self.pool)
                .await?,
        )
    }
    async fn redis_get(&self, key: &str) -> Option<Arc<DashboardPayload>> {
        let client = self.redis.as_ref()?;
        let value = tokio::time::timeout(Duration::from_millis(300), async {
            let mut conn = client.get_multiplexed_async_connection().await.ok()?;
            let bytes: Vec<u8> = redis::cmd("GET")
                .arg(key)
                .query_async(&mut conn)
                .await
                .ok()?;
            let value: Value = serde_json::from_slice(&bytes).ok()?;
            Some(Arc::new(DashboardPayload {
                value,
                encoded: Bytes::from(bytes),
            }))
        })
        .await
        .ok()??;
        Some(value)
    }
    async fn redis_put(&self, key: &str, value: &DashboardPayload) {
        if let Some(client) = &self.redis {
            if self.ttl.is_zero() {
                return;
            }
            let _ = tokio::time::timeout(Duration::from_millis(300), async {
                let mut conn = client.get_multiplexed_async_connection().await?;
                redis::cmd("SET")
                    .arg(key)
                    .arg(value.encoded.as_ref())
                    .arg("EX")
                    .arg(self.ttl.as_secs().max(1))
                    .query_async::<()>(&mut conn)
                    .await
            })
            .await;
        }
    }
    async fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.cache.write().await = None;
    }
    async fn cached(&self) -> Option<Arc<DashboardPayload>> {
        let (revision, _) = self.revision().await.ok()?;
        self.cache
            .read()
            .await
            .as_ref()
            .filter(|c| {
                c.created.elapsed() < self.ttl
                    && c.revision == revision
                    && c.generation == self.generation.load(Ordering::SeqCst)
            })
            .map(|c| c.value.clone())
    }
    async fn dashboard(&self) -> ApiResult<Arc<DashboardPayload>> {
        if let Some(value) = self.cached().await {
            return Ok(value);
        }
        // Coalesce concurrent misses to avoid a burst of identical database work.
        let _guard = self.refresh.lock().await;
        if let Some(value) = self.cached().await {
            return Ok(value);
        }
        let generation = self.generation.load(Ordering::SeqCst);
        let (revision, namespace) = self.revision().await?;
        let key = format!("healthcare:{namespace}:dashboard:v2:{revision}");
        if !self.ttl.is_zero()
            && let Some(value) = self.redis_get(&key).await
        {
            *self.cache.write().await = Some(CachedDashboard {
                generation,
                revision,
                created: Instant::now(),
                value: value.clone(),
            });
            return Ok(value);
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *tx)
            .await?;
        let (revision, namespace): (i64, String) =
            sqlx::query_as("SELECT version,namespace FROM data_revision WHERE id=1")
                .fetch_one(&mut *tx)
                .await?;
        let key = format!("healthcare:{namespace}:dashboard:v2:{revision}");
        let facilities = rows(
            &mut tx,
            "SELECT to_jsonb(f) FROM facility f ORDER BY facility_id",
        )
        .await?;
        let compliance = rows(
            &mut tx,
            "SELECT to_jsonb(c) FROM compliance_check c ORDER BY check_id",
        )
        .await?;
        let risks = rows(&mut tx, include_str!("risk.sql"))
            .await?
            .into_iter()
            .map(risk::score)
            .collect::<Vec<_>>();
        tx.commit().await?;
        let value = json!({"facilities": facilities, "compliance_checks": compliance, "facility_risks": risks});
        let encoded = serde_json::to_vec(&value).map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not encode dashboard".into(),
            )
        })?;
        let value = Arc::new(DashboardPayload {
            value,
            encoded: Bytes::from(encoded),
        });
        self.redis_put(&key, &value).await;
        let mut cache = self.cache.write().await;
        if generation == self.generation.load(Ordering::SeqCst) {
            *cache = Some(CachedDashboard {
                generation,
                revision,
                created: Instant::now(),
                value: value.clone(),
            });
        }
        Ok(value)
    }
}
async fn rows(tx: &mut Transaction<'_, Postgres>, sql: &str) -> ApiResult<Vec<Value>> {
    Ok(sqlx::query_scalar(sql).fetch_all(&mut **tx).await?)
}
pub fn router(state: AppState, origins: Vec<HeaderValue>) -> Router {
    let protected = Router::new()
        .route("/dashboard", get(dashboard))
        .route("/facilities", get(facilities))
        .route("/facility-risks", get(risks))
        .route("/facilities/{facility_id}/compliance", get(compliance))
        .route("/facilities/{facility_id}/summary", get(summary))
        .route("/{resource}", get(records::list).post(records::create))
        .route(
            "/{resource}/{id}",
            get(records::get_record)
                .put(records::update)
                .delete(records::delete),
        )
        .route("/auth/me", get(auth::me))
        .route("/auth/logout", axum::routing::post(auth::logout))
        .route("/auth/password", axum::routing::post(auth::change_password))
        .route("/auth/users", get(auth::users).post(auth::create_user))
        .route("/auth/users/{id}", axum::routing::patch(auth::change_user))
        .route("/audit-logs", get(extensions::audit))
        .route("/facilities-nearby", get(extensions::nearby))
        .route("/risk-analysis/{id}", get(extensions::analysis))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::protect,
        ));
    Router::new()
        .merge(protected)
        .route(
            "/",
            get(|| async { Json(json!({"message":"Correctional Healthcare Rust API"})) }),
        )
        .route("/health", get(health))
        .route("/auth/login", axum::routing::post(auth::login))
        .layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::PATCH,
                ])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                ]),
        )
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
async fn health(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok(Json(json!({"status":"healthy"})))
}
async fn dashboard(State(state): State<AppState>) -> ApiResult<impl IntoResponse> {
    let payload = state.dashboard().await?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        payload.encoded.clone(),
    ))
}

async fn facilities(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    // Reuse a warm dashboard without computing risk scores on a standalone cold facilities request.
    if let Some(value) = state.cached().await {
        return Ok(Json(value.value["facilities"].clone()));
    }
    let rows: Vec<Value> =
        sqlx::query_scalar("SELECT to_jsonb(f) FROM facility f ORDER BY facility_id")
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(json!(rows)))
}
async fn risks(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(
        state.dashboard().await?.value["facility_risks"].clone(),
    ))
}
async fn compliance(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let rows: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(t) FROM (SELECT f.facility_id, f.facility_name, f.state, c.check_id, c.violation_count FROM facility f JOIN compliance_check c USING(facility_id) WHERE f.facility_id=$1 ORDER BY c.check_id) t").bind(id).fetch_all(&state.pool).await?;
    Ok(Json(json!(rows)))
}
async fn summary(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let row: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(t) FROM (SELECT f.facility_id, f.facility_name, f.state, count(c.check_id) AS total_checks, coalesce(sum(c.violation_count),0) AS total_violations FROM facility f LEFT JOIN compliance_check c USING(facility_id) WHERE f.facility_id=$1 GROUP BY f.facility_id) t").bind(id).fetch_optional(&state.pool).await?;
    Ok(Json(row.ok_or_else(|| {
        ApiError(StatusCode::NOT_FOUND, "Facility not found".into())
    })?))
}
