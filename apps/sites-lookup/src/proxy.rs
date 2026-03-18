use axum::{
    body::Body,
    extract::State,
    http::{header, Request, Response, StatusCode, Uri},
    response::IntoResponse,
};
use http_body_util::BodyExt;
use std::sync::Arc;
use std::time::Instant;

use crate::{analytics, cache, db, AppState};

/// Proxy handler - intercepts all site requests and forwards to executor
pub async fn proxy_handler(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
) -> impl IntoResponse {
    // Start timing for analytics
    let start_time = Instant::now();

    // Extract hostname from Host header
    let hostname = match req.headers().get(header::HOST) {
        Some(h) => h.to_str().unwrap_or("").split(':').next().unwrap_or("").to_lowercase(),
        None => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Missing Host header"))
                .unwrap();
        }
    };

    // Skip proxy for internal endpoints
    let path = req.uri().path();
    if path == "/health" || path == "/lookup" || path == "/invalidate" {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not found"))
            .unwrap();
    }

    // Capture analytics data before consuming the request
    let user_agent = req.headers()
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let referrer = req.headers()
        .get(header::REFERER)
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let country = req.headers()
        .get("cf-ipcountry")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let client_ip = req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| req.headers()
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .map(String::from))
        .unwrap_or_else(|| "unknown".to_string());

    // Look up route info
    let mut redis = state.redis.clone();

    tracing::info!("Proxy request for hostname: {} path: {}", hostname, path);

    // Try cache first
    let route = if let Some(r) = cache::get_cached_route(&mut redis, &hostname).await {
        tracing::info!("Cache hit for {}", hostname);
        r
    } else {
        tracing::info!("Cache miss for {}, querying database", hostname);

        // Database lookup
        match db::lookup_route(&state.db, &hostname).await {
            Ok(Some(r)) => {
                tracing::info!("Route found for {}: runtime_id={}", hostname, r.runtime_id);
                // Cache the result
                if let Err(e) = cache::set_cached_route(&mut redis, &hostname, &r, state.cache_ttl).await {
                    tracing::warn!("Failed to cache route for {}: {}", hostname, e);
                }
                r
            }
            Ok(None) => {
                tracing::warn!("No route found for {} - check domain status, site_domains, and deployment status", hostname);
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("Site not found"))
                    .unwrap();
            }
            Err(e) => {
                tracing::error!("Database error for {}: {}", hostname, e);
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("Internal error"))
                    .unwrap();
            }
        }
    };

    // Build executor URL: /v1/runtimes/{runtimeId}/executions
    let executor_uri: Uri = format!(
        "{}/v1/runtimes/{}/executions",
        state.executor_endpoint,
        route.runtime_id
    )
    .parse()
    .expect("Invalid executor endpoint");

    // Get original request info
    let original_path = req.uri().path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();
    let original_method = req.method().to_string();

    // Collect original headers as JSON
    let mut original_headers: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (name, value) in req.headers().iter() {
        if let Ok(v) = value.to_str() {
            original_headers.insert(name.to_string(), v.to_string());
        }
    }

    // Read request body
    let body_bytes = match req.into_body().collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            tracing::error!("Failed to read request body: {}", e);
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Failed to read request body"))
                .unwrap();
        }
    };
    let request_body_size = body_bytes.len() as u64;

    // Build multipart form data for executor
    let boundary = format!("----WebKitFormBoundary{}", uuid::Uuid::new_v4().simple());
    let mut form_body = Vec::new();

    // Helper to add form field
    fn add_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", name).as_bytes());
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    add_field(&mut form_body, &boundary, "runtimeId", &route.runtime_id);
    add_field(&mut form_body, &boundary, "path", &original_path);
    add_field(&mut form_body, &boundary, "method", &original_method);
    add_field(&mut form_body, &boundary, "headers", &serde_json::to_string(&original_headers).unwrap_or_default());
    add_field(&mut form_body, &boundary, "image", &route.image);
    add_field(&mut form_body, &boundary, "source", &route.source);
    add_field(&mut form_body, &boundary, "entrypoint", &route.entrypoint);
    add_field(&mut form_body, &boundary, "variables", &serde_json::to_string(&route.variables).unwrap_or_default());
    add_field(&mut form_body, &boundary, "timeout", &route.timeout.to_string());
    add_field(&mut form_body, &boundary, "cpus", &route.cpus.to_string());
    add_field(&mut form_body, &boundary, "memory", &route.memory.to_string());
    add_field(&mut form_body, &boundary, "version", "v5");
    add_field(&mut form_body, &boundary, "runtimeEntrypoint", "");
    add_field(&mut form_body, &boundary, "logging", "true");
    add_field(&mut form_body, &boundary, "restartPolicy", "always");

    // Add body if not empty
    if !body_bytes.is_empty() {
        add_field(&mut form_body, &boundary, "body", &String::from_utf8_lossy(&body_bytes));
    }

    // End boundary
    form_body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    // Build the request to executor
    let executor_req = Request::builder()
        .method("POST")
        .uri(executor_uri)
        .header("authorization", format!("Bearer {}", state.executor_secret))
        .header("x-opr-runtime-id", &route.runtime_id)
        .header("x-opr-addressing-method", "anycast-efficient")
        .header("content-type", format!("multipart/form-data; boundary={}", boundary))
        .header("accept", "multipart/form-data")
        .body(Body::from(form_body))
        .unwrap();

    tracing::info!("Proxying to executor: {}/v1/runtimes/{}/executions", state.executor_endpoint, route.runtime_id);

    // Forward request to executor
    match tokio::time::timeout(
        std::time::Duration::from_secs(state.executor_timeout_secs),
        state.http_client.request(executor_req),
    ).await {
        Err(_) => {
            tracing::error!("Executor request timed out after {}s for {}", state.executor_timeout_secs, hostname);
            return Response::builder()
                .status(StatusCode::GATEWAY_TIMEOUT)
                .body(Body::from("Executor request timed out"))
                .unwrap();
        }
        Ok(result) => match result {
        Ok(resp) => {
            // Parse the multipart response from executor
            let content_type = resp.headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");

            if !content_type.contains("multipart/form-data") {
                // Not multipart - return as-is (shouldn't happen normally)
                let (parts, body) = resp.into_parts();
                let body = Body::new(body.map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
                }));
                return Response::from_parts(parts, body);
            }

            // Extract boundary
            let boundary = content_type
                .split("boundary=")
                .nth(1)
                .unwrap_or("")
                .to_string();

            // Read full response body
            let body_bytes = match resp.into_body().collect().await {
                Ok(collected) => collected.to_bytes(),
                Err(e) => {
                    tracing::error!("Failed to read executor response: {}", e);
                    return Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Body::from("Failed to read executor response"))
                        .unwrap();
                }
            };

            // Parse multipart response in binary mode to preserve body content
            let mut status_code: u16 = 200;
            let mut response_headers: std::collections::HashMap<String, String> = std::collections::HashMap::new();
            let mut response_body: Vec<u8> = Vec::new();

            // Find boundary positions in binary data
            let boundary_bytes = format!("--{}", boundary).into_bytes();
            let mut parts: Vec<(usize, usize)> = Vec::new();
            let mut i = 0;
            while i <= body_bytes.len().saturating_sub(boundary_bytes.len()) {
                if body_bytes[i..].starts_with(&boundary_bytes) {
                    parts.push((i, i + boundary_bytes.len()));
                    i += boundary_bytes.len();
                } else {
                    i += 1;
                }
            }

            // Parse each part between boundaries
            for window in parts.windows(2) {
                let (_, start) = window[0];
                let (end, _) = window[1];

                // Skip CRLF after boundary
                let mut content_start = start;
                if content_start < body_bytes.len() && body_bytes.get(content_start) == Some(&b'\r') {
                    content_start += 1;
                }
                if content_start < body_bytes.len() && body_bytes.get(content_start) == Some(&b'\n') {
                    content_start += 1;
                }

                // Find CRLFCRLF separator between headers and body
                let part_data = &body_bytes[content_start..end];
                let mut header_end = None;
                for j in 0..part_data.len().saturating_sub(3) {
                    if part_data[j..].starts_with(b"\r\n\r\n") {
                        header_end = Some(j);
                        break;
                    }
                }

                if let Some(sep) = header_end {
                    let headers_bytes = &part_data[..sep];
                    let headers_str = String::from_utf8_lossy(headers_bytes);

                    // Body starts after CRLFCRLF
                    let body_start = sep + 4;
                    let mut body_end = part_data.len();
                    // Remove trailing CRLF
                    if body_end >= 2 && part_data[body_end - 2] == b'\r' && part_data[body_end - 1] == b'\n' {
                        body_end -= 2;
                    }

                    // Extract field name
                    if let Some(name_match) = headers_str.find("name=\"") {
                        let name_start = name_match + 6;
                        if let Some(name_end) = headers_str[name_start..].find('"') {
                            let name = &headers_str[name_start..name_start + name_end];
                            let field_body = &part_data[body_start..body_end];

                            match name {
                                "statusCode" => {
                                    let val_str = String::from_utf8_lossy(field_body);
                                    status_code = val_str.trim().parse().unwrap_or(200);
                                }
                                "headers" => {
                                    let val_str = String::from_utf8_lossy(field_body);
                                    if let Ok(headers_json) = serde_json::from_str::<serde_json::Value>(&val_str) {
                                        if let Some(obj) = headers_json.as_object() {
                                            for (k, v) in obj {
                                                if let Some(val) = v.as_str() {
                                                    response_headers.insert(k.clone(), val.to_string());
                                                }
                                            }
                                        }
                                    }
                                }
                                "body" => {
                                    // Keep body as raw bytes to preserve binary content
                                    response_body = field_body.to_vec();
                                }
                                _ => {} // Ignore logs, errors, duration, etc.
                            }
                        }
                    }
                }
            }

            // Build the actual HTTP response
            let mut builder = Response::builder().status(status_code);

            for (key, value) in &response_headers {
                // Skip transfer-encoding as we're sending the full body
                if key.to_lowercase() != "transfer-encoding" {
                    builder = builder.header(key.as_str(), value.as_str());
                }
            }

            // Calculate response time and capture body size for analytics
            let response_time_ms = start_time.elapsed().as_millis() as u64;
            let response_body_size = response_body.len() as u64;

            // Spawn async task to track analytics (non-blocking)
            let analytics_redis = state.redis.clone();
            let analytics_data = analytics::PageViewData {
                site_id: route.site_id.clone(),
                domain_id: route.domain_id.clone(),
                deployment_id: route.deployment_id.clone(),
                domain: hostname.clone(),
                path: original_path.clone(),
                referrer,
                user_agent,
                country,
                response_code: status_code,
                response_time_ms,
                bytes_in: request_body_size,
                bytes_out: response_body_size,
                visitor_id: analytics::generate_visitor_id(&client_ip, &original_headers.get("user-agent").cloned().unwrap_or_default()),
            };

            tokio::spawn(async move {
                let mut redis = analytics_redis;
                if let Err(e) = analytics::track_page_view(&mut redis, analytics_data).await {
                    tracing::warn!("Failed to track page view: {}", e);
                }
            });

            builder
                .body(Body::from(response_body))
                .unwrap_or_else(|_| {
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Body::from("Failed to build response"))
                        .unwrap()
                })
        }
        Err(e) => {
            tracing::error!("Proxy error for {}: {}", hostname, e);
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(format!("Proxy error: {}", e)))
                .unwrap()
        }
        }  // end Ok(result) => match result
    }  // end match timeout
}
