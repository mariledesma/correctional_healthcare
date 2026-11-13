use crate::{
    AppState,
    error::{ApiError, ApiResult},
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Extension, Json,
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;

static HASH_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));
#[derive(Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub username: String,
    pub role: String,
    pub active: bool,
}
pub fn digest(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}
pub fn token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
pub async fn hash_password(password: String) -> ApiResult<String> {
    if !(12..=128).contains(&password.len()) {
        return Err(ApiError::invalid("Password must contain 12–128 bytes"));
    }
    let permit = HASH_SLOTS
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| unavailable())?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
            .map_err(|_| unavailable())
    })
    .await
    .map_err(|_| unavailable())?
}
fn unavailable() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Authentication unavailable".into(),
    )
}
pub fn username(s: &str) -> ApiResult<String> {
    let s = s.trim().to_lowercase();
    if !(3..=100).contains(&s.len())
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.@-".contains(&b))
    {
        return Err(ApiError::invalid(
            "Use 3–100 letters, digits, or _.@- in the username",
        ));
    }
    Ok(s)
}
fn valid_role(role: &str) -> ApiResult<()> {
    if ["viewer", "editor", "admin"].contains(&role) {
        Ok(())
    } else {
        Err(ApiError::invalid("Unknown role"))
    }
}
fn admin(user: &User) -> ApiResult<()> {
    if user.role == "admin" {
        Ok(())
    } else {
        Err(ApiError(
            StatusCode::FORBIDDEN,
            "Administrator access required".into(),
        ))
    }
}
pub async fn transaction<'a>(
    pool: &'a PgPool,
    actor: &str,
) -> ApiResult<Transaction<'a, Postgres>> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('app.actor_id',$1,true)")
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}
pub async fn protect(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> ApiResult<Response> {
    let bearer = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "Please sign in".into()))?;
    let user: User=sqlx::query_as("SELECT u.id,u.username,u.role,u.active FROM app_user u JOIN login_session s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active")
        .bind(digest(bearer)).fetch_optional(&state.pool).await?.ok_or_else(||ApiError(StatusCode::UNAUTHORIZED,"Session expired; please sign in".into()))?;
    let method = request.method().as_str();
    let own_auth =
        request.uri().path() == "/auth/logout" || request.uri().path() == "/auth/password";
    if !own_auth
        && ((method == "DELETE" && user.role != "admin")
            || (!["GET", "HEAD", "OPTIONS", "DELETE"].contains(&method) && user.role == "viewer"))
    {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Your role does not permit this action".into(),
        ));
    }
    let session_digest = digest(bearer);
    request.extensions_mut().insert(user);
    request
        .extensions_mut()
        .insert(SessionDigest(session_digest));
    Ok(next.run(request).await)
}
#[derive(Clone)]
pub struct SessionDigest(String);
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    username: String,
    password: String,
}
pub async fn login(
    State(state): State<AppState>,
    Json(data): Json<Credentials>,
) -> ApiResult<Json<Value>> {
    let name = username(&data.username)?;
    if data.password.len() > 128 {
        return Err(ApiError::invalid("Password too long"));
    }
    // Atomic database throttling applies to existing and nonexistent usernames across API replicas.
    let attempts: i32=sqlx::query_scalar("INSERT INTO login_throttle(username,attempts) VALUES($1,1) ON CONFLICT(username) DO UPDATE SET attempts=CASE WHEN login_throttle.window_start<now()-interval '15 minutes' THEN 1 ELSE login_throttle.attempts+1 END, window_start=CASE WHEN login_throttle.window_start<now()-interval '15 minutes' THEN now() ELSE login_throttle.window_start END RETURNING attempts")
        .bind(&name).fetch_one(&state.pool).await?;
    if attempts > 5 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts; try again in 15 minutes".into(),
        ));
    }
    let found: Option<(String, String)> =
        sqlx::query_as("SELECT id,password_hash FROM app_user WHERE username=$1 AND active")
            .bind(&name)
            .fetch_optional(&state.pool)
            .await?;
    let expected = found.as_ref().map(|v| v.1.clone());
    let permit = HASH_SLOTS
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| unavailable())?;
    let valid = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if let Some(expected) = expected {
            PasswordHash::new(&expected).is_ok_and(|hash| {
                Argon2::default()
                    .verify_password(data.password.as_bytes(), &hash)
                    .is_ok()
            })
        } else {
            let _ = Argon2::default()
                .hash_password(data.password.as_bytes(), &SaltString::generate(&mut OsRng));
            false
        }
    })
    .await
    .map_err(|_| unavailable())?;
    if !valid {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid username or password".into(),
        ));
    }
    let (id, old_hash) = found.ok_or_else(unavailable)?;
    let mut tx = transaction(&state.pool, &id).await?;
    // Recheck after password hashing so a concurrent password change/deactivation cannot issue a session.
    let user: User=sqlx::query_as("SELECT id,username,role,active FROM app_user WHERE id=$1 AND password_hash=$2 AND active FOR UPDATE")
        .bind(&id).bind(old_hash).fetch_optional(&mut *tx).await?.ok_or_else(||ApiError(StatusCode::UNAUTHORIZED,"Account changed; sign in again".into()))?;
    let raw = token();
    sqlx::query("INSERT INTO login_session(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')").bind(digest(&raw)).bind(&id).execute(&mut *tx).await?;
    sqlx::query(
        "DELETE FROM login_throttle WHERE username=$1 OR window_start<now()-interval '1 day'",
    )
    .bind(&name)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM login_session WHERE expires_at<now()")
        .execute(&mut *tx)
        .await?;
    security_event(&mut tx, &id, "LOGIN").await?;
    tx.commit().await?;
    Ok(Json(json!({"access_token":raw,"user":user})))
}
async fn security_event(
    tx: &mut Transaction<'_, Postgres>,
    id: &str,
    operation: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO audit_log(actor_id,table_name,operation,record_id) VALUES($1,'authentication',$2,$1)").bind(id).bind(operation).execute(&mut **tx).await?;
    Ok(())
}
pub async fn me(Extension(user): Extension<User>) -> Json<User> {
    Json(user)
}
pub async fn logout(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Extension(session): Extension<SessionDigest>,
) -> ApiResult<StatusCode> {
    let mut tx = transaction(&state.pool, &user.id).await?;
    sqlx::query("DELETE FROM login_session WHERE token_hash=$1")
        .bind(session.0)
        .execute(&mut *tx)
        .await?;
    security_event(&mut tx, &user.id, "LOGOUT").await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewUser {
    username: String,
    password: String,
    role: String,
}
pub async fn create_user(
    State(state): State<AppState>,
    Extension(actor): Extension<User>,
    Json(data): Json<NewUser>,
) -> ApiResult<(StatusCode, Json<User>)> {
    admin(&actor)?;
    valid_role(&data.role)?;
    let name = username(&data.username)?;
    let hash = hash_password(data.password).await?;
    let mut tx = transaction(&state.pool, &actor.id).await?;
    let user=sqlx::query_as("INSERT INTO app_user(id,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,username,role,active")
        .bind(uuid::Uuid::new_v4().to_string()).bind(name).bind(hash).bind(data.role).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(user)))
}
pub async fn users(
    State(state): State<AppState>,
    Extension(actor): Extension<User>,
) -> ApiResult<Json<Vec<User>>> {
    admin(&actor)?;
    Ok(Json(
        sqlx::query_as("SELECT id,username,role,active FROM app_user ORDER BY username")
            .fetch_all(&state.pool)
            .await?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeUser {
    role: String,
    active: bool,
}
pub async fn change_user(
    State(state): State<AppState>,
    Extension(actor): Extension<User>,
    Path(id): Path<String>,
    Json(data): Json<ChangeUser>,
) -> ApiResult<Json<User>> {
    admin(&actor)?;
    valid_role(&data.role)?;
    if actor.id == id {
        return Err(ApiError::invalid(
            "Ask another administrator to change your own access",
        ));
    }
    let mut tx = transaction(&state.pool, &actor.id).await?;
    // Serialize account administration and recheck actor to protect the last active admin under races.
    sqlx::query("SELECT pg_advisory_xact_lock(5560001)")
        .execute(&mut *tx)
        .await?;
    let still_admin: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM app_user WHERE id=$1 AND active AND role='admin')",
    )
    .bind(&actor.id)
    .fetch_one(&mut *tx)
    .await?;
    if !still_admin {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "Administrator access revoked".into(),
        ));
    }
    let user = sqlx::query_as(
        "UPDATE app_user SET role=$1,active=$2 WHERE id=$3 RETURNING id,username,role,active",
    )
    .bind(data.role)
    .bind(data.active)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::missing)?;
    sqlx::query("DELETE FROM login_session WHERE user_id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(user))
}
#[derive(Deserialize)]
pub struct PasswordChange {
    current_password: String,
    new_password: String,
}
pub async fn change_password(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(data): Json<PasswordChange>,
) -> ApiResult<StatusCode> {
    if data.current_password.len() > 128 {
        return Err(ApiError::invalid("Password too long"));
    }
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM app_user WHERE id=$1")
        .bind(&user.id)
        .fetch_one(&state.pool)
        .await?;
    let old = hash.clone();
    let permit = HASH_SLOTS
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| unavailable())?;
    let valid = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        PasswordHash::new(&hash).is_ok_and(|h| {
            Argon2::default()
                .verify_password(data.current_password.as_bytes(), &h)
                .is_ok()
        })
    })
    .await
    .map_err(|_| unavailable())?;
    if !valid {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Incorrect current password".into(),
        ));
    }
    let new = hash_password(data.new_password).await?;
    let mut tx = transaction(&state.pool, &user.id).await?;
    if sqlx::query("UPDATE app_user SET password_hash=$1 WHERE id=$2 AND password_hash=$3")
        .bind(new)
        .bind(&user.id)
        .bind(old)
        .execute(&mut *tx)
        .await?
        .rows_affected()
        != 1
    {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Password changed; try again".into(),
        ));
    }
    sqlx::query("DELETE FROM login_session WHERE user_id=$1")
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn bootstrap(pool: &PgPool, name: &str, password: String) -> ApiResult<()> {
    let name = username(name)?;
    let hash = hash_password(password).await?;
    let mut tx = transaction(pool, "bootstrap-cli").await?;
    sqlx::query("SELECT pg_advisory_xact_lock(5560001)")
        .execute(&mut *tx)
        .await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM app_user WHERE role='admin' AND active)")
            .fetch_one(&mut *tx)
            .await?;
    if exists {
        return Err(ApiError::invalid(
            "An administrator already exists; sign in to manage accounts",
        ));
    }
    sqlx::query("INSERT INTO app_user(id,username,password_hash,role) VALUES($1,$2,$3,'admin')")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(name)
        .bind(hash)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
