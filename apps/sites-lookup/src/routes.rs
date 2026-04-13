use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{cache, db, AppState};

/// Maximum allowed hostname length (RFC 1035 limit is 253)
const MAX_HOSTNAME_LENGTH: usize = 253;

/// Validate a hostname format for security
/// Returns None if valid, Some(error_message) if invalid
fn validate_hostname(hostname: &str) -> Option<String> {
    // Check length
    if hostname.is_empty() {
        return Some("Hostname cannot be empty".to_string());
    }
    if hostname.len() > MAX_HOSTNAME_LENGTH {
        return Some(format!("Hostname exceeds maximum length of {}", MAX_HOSTNAME_LENGTH));
    }

    // Check for null bytes or control characters
    if hostname.chars().any(|c| c.is_control() || c == '\0') {
        return Some("Hostname contains invalid characters".to_string());
    }

    // Check for consecutive dots
    if hostname.contains("..") {
        return Some("Hostname contains consecutive dots".to_string());
    }

    // Basic format validation - allow alphanumeric, dots, and hyphens
    // Wildcards are stripped before validation
    let check_name = hostname.strip_prefix("*.").unwrap_or(hostname);
    for label in check_name.split('.') {
        if label.is_empty() {
            return Some("Hostname has empty label".to_string());
        }
        if label.len() > 63 {
            return Some(format!("Label '{}' exceeds 63 character limit", label));
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Some(format!("Label '{}' cannot start or end with hyphen", label));
        }
        if !label.chars().all(|c| c.is_alphanumeric() || c == '-') {
            return Some(format!("Label '{}' contains invalid characters", label));
        }
    }

    None
}

/// Verify Bearer token authentication
fn verify_auth(headers: &HeaderMap, expected_secret: &str) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    let auth_header = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !auth_header.starts_with("Bearer ") {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Missing or invalid Authorization header. Use: Authorization: Bearer <token>".to_string(),
            }),
        ));
    }

    let token = &auth_header[7..]; // Skip "Bearer "

    // Timing-safe comparison
    if !constant_time_eq(token.as_bytes(), expected_secret.as_bytes()) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Invalid authentication token".to_string(),
            }),
        ));
    }

    Ok(())
}

/// Constant-time string comparison to prevent timing attacks
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }
    result == 0
}

#[derive(Debug, Deserialize)]
pub struct LookupQuery {
    hostname: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    error: String,
}

/// Lookup route info by hostname
pub async fn lookup(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LookupQuery>,
) -> impl IntoResponse {
    let hostname = query.hostname.to_lowercase();

    // SECURITY: Validate hostname format
    if let Some(error) = validate_hostname(&hostname) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error }),
        ).into_response();
    }

    // Try cache first
    let mut redis = state.redis.clone();
    if let Some(route) = cache::get_cached_route(&mut redis, &hostname).await {
        tracing::debug!("Cache hit for {}", hostname);
        return (StatusCode::OK, Json(route)).into_response();
    }

    tracing::debug!("Cache miss for {}", hostname);

    // Database lookup
    match db::lookup_route(&state.db, &hostname).await {
        Ok(Some(route)) => {
            // Cache the result
            if let Err(e) = cache::set_cached_route(&mut redis, &hostname, &route, state.cache_ttl).await {
                tracing::warn!("Failed to cache route for {}: {}", hostname, e);
            }

            (StatusCode::OK, Json(route)).into_response()
        }
        Ok(None) => {
            let response = ErrorResponse {
                error: "Not found".to_string(),
            };
            (StatusCode::NOT_FOUND, Json(response)).into_response()
        }
        Err(e) => {
            tracing::error!("Database error for {}: {}", hostname, e);
            let response = ErrorResponse {
                error: "Internal error".to_string(),
            };
            (StatusCode::INTERNAL_SERVER_ERROR, Json(response)).into_response()
        }
    }
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    status: String,
}

/// Health check endpoint
pub async fn health() -> impl IntoResponse {
    let response = HealthResponse {
        status: "ok".to_string(),
    };
    (StatusCode::OK, Json(response))
}

#[derive(Debug, Deserialize)]
pub struct InvalidateRequest {
    #[serde(default)]
    site_id: Option<String>,
    #[serde(default)]
    hostnames: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct InvalidateResponse {
    invalidated: u64,
}

/// Invalidate cache entries (always requires authentication)
pub async fn invalidate_cache(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<InvalidateRequest>,
) -> impl IntoResponse {
    if let Err(response) = verify_auth(&headers, &state.invalidate_secret) {
        return response.into_response();
    }

    // SECURITY: Validate hostnames if provided
    if let Some(ref hostnames) = request.hostnames {
        for hostname in hostnames {
            if let Some(error) = validate_hostname(hostname) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse { error: format!("Invalid hostname '{}': {}", hostname, error) }),
                ).into_response();
            }
        }
    }

    let mut redis = state.redis.clone();

    let count = if let Some(site_id) = request.site_id {
        // Invalidate all hostnames for a site
        match cache::invalidate_site(&state.db, &mut redis, &site_id).await {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to invalidate site {}: {}", site_id, e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: format!("Failed to invalidate: {}", e),
                    }),
                )
                    .into_response();
            }
        }
    } else if let Some(hostnames) = request.hostnames {
        // Invalidate specific hostnames
        match cache::invalidate_hostnames(&mut redis, &hostnames).await {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to invalidate hostnames: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: format!("Failed to invalidate: {}", e),
                    }),
                )
                    .into_response();
            }
        }
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Either site_id or hostnames must be provided".to_string(),
            }),
        )
            .into_response();
    };

    tracing::info!("Invalidated {} cache entries", count);
    (StatusCode::OK, Json(InvalidateResponse { invalidated: count })).into_response()
}
