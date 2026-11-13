use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);
pub type ApiResult<T> = Result<T, ApiError>;
impl ApiError {
    pub fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "Record not found".into())
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self(StatusCode::UNPROCESSABLE_ENTITY, message.into())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"detail": self.1}))).into_response()
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        if let sqlx::Error::Database(ref db) = error {
            match db.code().as_deref() {
                Some("23505") => {
                    return Self(StatusCode::CONFLICT, "Record ID already exists".into());
                }
                Some("23503") => {
                    return Self(
                        StatusCode::CONFLICT,
                        "Facility does not exist or record is referenced".into(),
                    );
                }
                Some("23502" | "23514" | "22003" | "22007" | "22008" | "22P02") => {
                    return Self::invalid("Invalid field value");
                }
                _ => {}
            }
        }
        tracing::error!(%error, "Database operation failed");
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            "Database unavailable".into(),
        )
    }
}
