use correctional_healthcare_api::{AppState, router};
use sqlx::postgres::PgPoolOptions;
use std::{env, time::Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=debug".into()),
        )
        .init();
    let database_url = env::var("DATABASE_URL")
        .map_err(|_| "Set DATABASE_URL to your PostgreSQL connection string")?
        .replacen("postgresql+psycopg2://", "postgresql://", 1)
        .replacen("postgresql+psycopg://", "postgresql://", 1);
    let pool = PgPoolOptions::new()
        .max_connections(
            env::var("DB_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "10".into())
                .parse()?,
        )
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout = '15s'")
                    .execute(conn)
                    .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await?;
    // Explicit opt-in: schema/index changes are never silently applied to an existing database.
    if env::args().any(|arg| arg == "--migrate") {
        sqlx::migrate!().run(&pool).await?;
        tracing::info!("Database migrations complete");
        return Ok(());
    }
    if env::args().any(|arg| arg == "--create-admin") {
        let name = rpassword::prompt_password("Administrator username (hidden): ")?;
        let password = rpassword::prompt_password("Password (12–128 characters): ")?;
        let confirm = rpassword::prompt_password("Confirm password: ")?;
        if password != confirm {
            return Err("Passwords do not match".into());
        }
        correctional_healthcare_api::auth::bootstrap(&pool, &name, password)
            .await
            .map_err(|e| e.1)?;
        println!("Administrator created. Sign in through the dashboard.");
        return Ok(());
    }
    if env::args().any(|arg| arg == "--enable-postgis") {
        sqlx::raw_sql(include_str!("../sql/postgis.sql"))
            .execute(&pool)
            .await?;
        println!("PostGIS enabled and indexed.");
        return Ok(());
    }
    let origins = env::var("CORS_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5173,http://127.0.0.1:5173".into())
        .split(',')
        .map(|s| s.trim().parse())
        .collect::<Result<Vec<_>, _>>()?;
    let ttl = env::var("CACHE_TTL_SECONDS")
        .unwrap_or_else(|_| "15".into())
        .parse()?;
    let app = router(
        AppState::new(pool.clone(), Duration::from_secs(ttl))
            .with_redis(env::var("REDIS_URL").ok().as_deref())?,
        origins,
    );
    let address = env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:8000".into());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    tracing::info!(%address, "Rust API listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
        })
        .await?;
    pool.close().await;
    Ok(())
}
