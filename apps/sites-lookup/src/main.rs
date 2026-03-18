mod analytics;
mod cache;
mod db;
mod proxy;
mod routes;

use axum::{body::Body, routing::get, Router};
use hyper_util::{client::legacy::Client, rt::TokioExecutor};
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub struct AppState {
    pub db: sqlx::PgPool,
    pub redis: redis::aio::ConnectionManager,
    pub cache_ttl: u64,
    pub executor_endpoint: String,
    pub executor_secret: String,
    /// Secret for authenticating /invalidate endpoint (optional, if empty invalidate is open)
    pub invalidate_secret: Option<String>,
    pub http_client: Client<hyper_util::client::legacy::connect::HttpConnector, Body>,
    pub executor_timeout_secs: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sites_lookup=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting sites-lookup service (proxy mode)");

    // Database connection
    let database_url = env::var("DATABASE_URL")
        .or_else(|_| env::var("UNI_PROXY_MANAGER_DB_URL"))
        .expect("DATABASE_URL or UNI_PROXY_MANAGER_DB_URL must be set");

    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;

    tracing::info!("Connected to PostgreSQL");

    // Redis connection
    let redis_url = env::var("REDIS_URL")
        .or_else(|_| env::var("UNI_PROXY_MANAGER_REDIS_URL"))
        .unwrap_or_else(|_| "redis://redis:6379".to_string());

    let redis_client = redis::Client::open(redis_url)?;
    let redis = redis::aio::ConnectionManager::new(redis_client).await?;

    tracing::info!("Connected to Redis");

    // Cache TTL
    let cache_ttl: u64 = env::var("SITES_CACHE_TTL")
        .unwrap_or_else(|_| "60".to_string())
        .parse()
        .unwrap_or(60);

    // Executor configuration
    let executor_endpoint = env::var("SITES_EXECUTOR_ENDPOINT")
        .unwrap_or_else(|_| "http://openruntimes-executor:80".to_string());

    // SECURITY: Require executor secret - fail fast if not configured
    let executor_secret = env::var("SITES_EXECUTOR_SECRET")
        .expect("SITES_EXECUTOR_SECRET must be set - this is required for secure communication with the executor");

    if executor_secret.is_empty() {
        panic!("SITES_EXECUTOR_SECRET cannot be empty - this is required for secure communication with the executor");
    }

    // SECURITY: Optional secret for /invalidate endpoint authentication
    // If set, /invalidate requires Bearer token matching this secret
    let invalidate_secret = env::var("SITES_INVALIDATE_SECRET")
        .or_else(|_| env::var("UNI_PROXY_MANAGER_API_KEY"))
        .ok()
        .filter(|s| !s.is_empty());

    if invalidate_secret.is_none() {
        tracing::warn!("SECURITY WARNING: SITES_INVALIDATE_SECRET or UNI_PROXY_MANAGER_API_KEY not set - /invalidate endpoint is UNPROTECTED");
    } else {
        tracing::info!("Invalidate endpoint authentication enabled");
    }

    tracing::info!("Executor endpoint: {}", executor_endpoint);

    let http_client: Client<_, Body> = Client::builder(TokioExecutor::new()).build_http();

    let executor_timeout_secs: u64 = env::var("SITES_EXECUTOR_TIMEOUT")
        .unwrap_or_else(|_| "30".to_string())
        .parse()
        .unwrap_or(30);

    let state = Arc::new(AppState {
        db,
        redis,
        cache_ttl,
        executor_endpoint,
        executor_secret,
        invalidate_secret,
        http_client,
        executor_timeout_secs,
    });

    // Build router - specific routes first, then fallback proxy
    let app = Router::new()
        .route("/lookup", get(routes::lookup))
        .route("/health", get(routes::health))
        .route("/invalidate", axum::routing::post(routes::invalidate_cache))
        .fallback(proxy::proxy_handler)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "3002".to_string())
        .parse()
        .unwrap_or(3002);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
