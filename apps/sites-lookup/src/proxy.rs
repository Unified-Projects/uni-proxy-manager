use axum::{
    body::Body,
    extract::State,
    http::{header, Request, Response, StatusCode, Uri},
    response::IntoResponse,
};
use http_body_util::BodyExt;
use std::collections::HashMap;
use std::fs::File as StdFile;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;

use crate::{analytics, cache, db, AppState};

const MULTIPART_SEARCH_CHUNK_SIZE: usize = 64 * 1024;
const MULTIPART_HEADER_SCAN_LIMIT: u64 = 64 * 1024;

struct ParsedExecutorResponse {
    status_code: u16,
    response_headers: HashMap<String, String>,
    body_range: Option<(u64, u64)>,
}

fn add_text_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", name).as_bytes(),
    );
    body.extend_from_slice(value.as_bytes());
    body.extend_from_slice(b"\r\n");
}

fn add_binary_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &[u8]) {
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", name).as_bytes(),
    );
    body.extend_from_slice(value);
    body.extend_from_slice(b"\r\n");
}

fn create_spool_path() -> PathBuf {
    std::env::temp_dir().join(format!("sites-lookup-executor-{}.multipart", uuid::Uuid::new_v4()))
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }

    haystack.windows(needle.len()).position(|window| window == needle)
}

fn find_sequence_in_file(file: &mut StdFile, needle: &[u8], start_offset: u64) -> io::Result<Option<u64>> {
    if needle.is_empty() {
        return Ok(Some(start_offset));
    }

    let overlap = needle.len().saturating_sub(1);
    let mut buffer = vec![0_u8; MULTIPART_SEARCH_CHUNK_SIZE + overlap];
    let mut carry_len = 0_usize;
    let mut file_offset = start_offset;

    file.seek(SeekFrom::Start(start_offset))?;

    loop {
        let read_len = file.read(&mut buffer[carry_len..carry_len + MULTIPART_SEARCH_CHUNK_SIZE])?;
        if read_len == 0 {
            return Ok(None);
        }

        let search_len = carry_len + read_len;
        if let Some(found_at) = find_subsequence(&buffer[..search_len], needle) {
            let base_offset = file_offset.saturating_sub(carry_len as u64);
            return Ok(Some(base_offset + found_at as u64));
        }

        if overlap > 0 {
            carry_len = overlap.min(search_len);
            buffer.copy_within(search_len - carry_len..search_len, 0);
        } else {
            carry_len = 0;
        }

        file_offset += read_len as u64;
    }
}

fn read_file_range(file: &mut StdFile, start: u64, end: u64) -> io::Result<Vec<u8>> {
    let length = end.saturating_sub(start);
    let mut bytes = vec![0_u8; length as usize];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn parse_part_name(headers: &str) -> Option<String> {
    let name_start = headers.find("name=\"")?;
    let value_start = name_start + 6;
    let value_end = headers[value_start..].find('"')?;
    Some(headers[value_start..value_start + value_end].to_string())
}

fn parse_executor_response_file(path: &Path, boundary: &str) -> io::Result<ParsedExecutorResponse> {
    let mut file = StdFile::open(path)?;
    let boundary_bytes = format!("--{}", boundary).into_bytes();
    let header_separator = b"\r\n\r\n";

    let mut status_code = 200_u16;
    let mut response_headers = HashMap::new();
    let mut body_range = None;

    let mut current_boundary = match find_sequence_in_file(&mut file, &boundary_bytes, 0)? {
        Some(position) => position,
        None => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Executor multipart response missing boundary",
            ))
        }
    };

    while let Some(next_boundary) = find_sequence_in_file(
        &mut file,
        &boundary_bytes,
        current_boundary + boundary_bytes.len() as u64,
    )? {
        let mut content_start = current_boundary + boundary_bytes.len() as u64;
        let mut prefix = [0_u8; 2];

        file.seek(SeekFrom::Start(content_start))?;
        let first_read = file.read(&mut prefix)?;
        if first_read >= 2 && prefix == [b'-', b'-'] {
            break;
        }
        if first_read >= 2 && prefix == [b'\r', b'\n'] {
            content_start += 2;
        } else if first_read >= 1 && prefix[0] == b'\n' {
            content_start += 1;
        }

        let header_scan_end = next_boundary.min(content_start + MULTIPART_HEADER_SCAN_LIMIT);
        let header_scan = read_file_range(&mut file, content_start, header_scan_end)?;
        let separator_pos = match find_subsequence(&header_scan, header_separator) {
            Some(position) => position,
            None => {
                current_boundary = next_boundary;
                continue;
            }
        };

        let headers_bytes = &header_scan[..separator_pos];
        let headers_str = String::from_utf8_lossy(headers_bytes);
        let Some(part_name) = parse_part_name(&headers_str) else {
            current_boundary = next_boundary;
            continue;
        };

        let body_start = content_start + separator_pos as u64 + header_separator.len() as u64;
        let mut body_end = next_boundary;

        if body_end >= 2 {
            let trailing = read_file_range(&mut file, body_end - 2, body_end)?;
            if trailing == b"\r\n" {
                body_end -= 2;
            }
        }

        match part_name.as_str() {
            "statusCode" => {
                let bytes = read_file_range(&mut file, body_start, body_end)?;
                let value = String::from_utf8_lossy(&bytes);
                status_code = value.trim().parse().unwrap_or(200);
            }
            "headers" => {
                let value = read_file_range(&mut file, body_start, body_end)?;
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&value) {
                    if let Some(object) = json.as_object() {
                        for (key, value) in object {
                            if let Some(as_str) = value.as_str() {
                                response_headers.insert(key.clone(), as_str.to_string());
                            }
                        }
                    }
                }
            }
            "body" => {
                body_range = Some((body_start, body_end));
            }
            _ => {}
        }

        current_boundary = next_boundary;
    }

    Ok(ParsedExecutorResponse {
        status_code,
        response_headers,
        body_range,
    })
}

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

    add_text_field(&mut form_body, &boundary, "runtimeId", &route.runtime_id);
    add_text_field(&mut form_body, &boundary, "path", &original_path);
    add_text_field(&mut form_body, &boundary, "method", &original_method);
    add_text_field(
        &mut form_body,
        &boundary,
        "headers",
        &serde_json::to_string(&original_headers).unwrap_or_default(),
    );
    add_text_field(&mut form_body, &boundary, "image", &route.image);
    add_text_field(&mut form_body, &boundary, "source", &route.source);
    add_text_field(&mut form_body, &boundary, "entrypoint", &route.entrypoint);
    add_text_field(
        &mut form_body,
        &boundary,
        "variables",
        &serde_json::to_string(&route.variables).unwrap_or_default(),
    );
    add_text_field(&mut form_body, &boundary, "timeout", &route.timeout.to_string());
    add_text_field(&mut form_body, &boundary, "cpus", &route.cpus.to_string());
    add_text_field(&mut form_body, &boundary, "memory", &route.memory.to_string());
    add_text_field(&mut form_body, &boundary, "version", "v5");
    add_text_field(&mut form_body, &boundary, "runtimeEntrypoint", "");
    add_text_field(&mut form_body, &boundary, "logging", "true");
    add_text_field(&mut form_body, &boundary, "restartPolicy", "always");

    // Add body if not empty
    if !body_bytes.is_empty() {
        add_binary_field(&mut form_body, &boundary, "body", &body_bytes);
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
                .trim_matches('"')
                .to_string();

            let spool_path = create_spool_path();
            let mut spool_file = match File::create(&spool_path).await {
                Ok(file) => file,
                Err(error) => {
                    tracing::error!("Failed to create executor spool file: {}", error);
                    return Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Body::from("Failed to spool executor response"))
                        .unwrap();
                }
            };

            let mut executor_body = resp.into_body();
            while let Some(frame_result) = executor_body.frame().await {
                let frame = match frame_result {
                    Ok(frame) => frame,
                    Err(error) => {
                        tracing::error!("Failed to read executor response frame: {}", error);
                        let _ = tokio::fs::remove_file(&spool_path).await;
                        return Response::builder()
                            .status(StatusCode::BAD_GATEWAY)
                            .body(Body::from("Failed to read executor response"))
                            .unwrap();
                    }
                };

                if let Some(data) = frame.data_ref() {
                    if let Err(error) = spool_file.write_all(data).await {
                        tracing::error!("Failed to write executor response to spool file: {}", error);
                        let _ = tokio::fs::remove_file(&spool_path).await;
                        return Response::builder()
                            .status(StatusCode::BAD_GATEWAY)
                            .body(Body::from("Failed to spool executor response"))
                            .unwrap();
                    }
                }
            }

            if let Err(error) = spool_file.flush().await {
                tracing::error!("Failed to flush executor spool file: {}", error);
                let _ = tokio::fs::remove_file(&spool_path).await;
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Body::from("Failed to finalize executor response"))
                    .unwrap();
            }

            drop(spool_file);

            let parsed = match parse_executor_response_file(&spool_path, &boundary) {
                Ok(parsed) => parsed,
                Err(error) => {
                    tracing::error!("Failed to parse executor multipart response: {}", error);
                    let _ = tokio::fs::remove_file(&spool_path).await;
                    return Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Body::from("Failed to parse executor response"))
                        .unwrap();
                }
            };

            // Build the actual HTTP response
            let mut builder = Response::builder().status(parsed.status_code);

            for (key, value) in &parsed.response_headers {
                // Skip transfer-encoding as we're sending the full body
                if key.to_lowercase() != "transfer-encoding" {
                    builder = builder.header(key.as_str(), value.as_str());
                }
            }

            let (response_body_size, response_body) = if let Some((body_start, body_end)) = parsed.body_range {
                let body_len = body_end.saturating_sub(body_start);
                let mut response_file = match File::open(&spool_path).await {
                    Ok(file) => file,
                    Err(error) => {
                        tracing::error!("Failed to reopen executor spool file: {}", error);
                        let _ = tokio::fs::remove_file(&spool_path).await;
                        return Response::builder()
                            .status(StatusCode::BAD_GATEWAY)
                            .body(Body::from("Failed to stream executor response"))
                            .unwrap();
                    }
                };

                if let Err(error) = response_file.seek(std::io::SeekFrom::Start(body_start)).await {
                    tracing::error!("Failed to seek executor response body: {}", error);
                    let _ = tokio::fs::remove_file(&spool_path).await;
                    return Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Body::from("Failed to stream executor response"))
                        .unwrap();
                }

                let _ = std::fs::remove_file(&spool_path);

                if !parsed.response_headers.contains_key("content-length") {
                    builder = builder.header("content-length", body_len.to_string());
                }

                let response_stream = ReaderStream::new(response_file.take(body_len));
                (body_len, Body::from_stream(response_stream))
            } else {
                let _ = tokio::fs::remove_file(&spool_path).await;
                (0, Body::from(Vec::<u8>::new()))
            };

            // Calculate response time and capture body size for analytics
            let response_time_ms = start_time.elapsed().as_millis() as u64;

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
                response_code: parsed.status_code,
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
                .body(response_body)
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

#[cfg(test)]
mod tests {
    use super::{add_binary_field, add_text_field, parse_executor_response_file};
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn text_field_uses_expected_multipart_shape() {
        let mut body = Vec::new();
        add_text_field(&mut body, "boundary", "path", "/hello");

        let expected = b"--boundary\r\nContent-Disposition: form-data; name=\"path\"\r\n\r\n/hello\r\n";
        assert_eq!(body, expected);
    }

    #[test]
    fn binary_field_preserves_non_utf8_bytes() {
        let payload = vec![0x00, 0x9f, 0xff, b'\r', b'\n', 0x80];
        let mut body = Vec::new();
        add_binary_field(&mut body, "boundary", "body", &payload);

        assert!(body.windows(payload.len()).any(|window| window == payload.as_slice()));
    }

    #[test]
    fn parses_spooled_multipart_response_and_tracks_body_range() {
        let boundary = "boundary";
        let body_payload = b"\x00binary-response\xff";
        let mut temp_path = std::env::temp_dir();
        temp_path.push(format!("sites-lookup-parser-{}.multipart", uuid::Uuid::new_v4()));

        let mut temp_file = File::create(&temp_path).expect("failed to create temp file");
        write!(temp_file, "--{boundary}\r\nContent-Disposition: form-data; name=\"body\"\r\nContent-Type: text/plain\r\n\r\n").unwrap();
        temp_file.write_all(body_payload).unwrap();
        write!(temp_file, "\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"statusCode\"\r\nContent-Type: text/plain\r\n\r\n201\r\n").unwrap();
        write!(temp_file, "--{boundary}\r\nContent-Disposition: form-data; name=\"headers\"\r\nContent-Type: application/json\r\n\r\n{{\"content-type\":\"application/octet-stream\"}}\r\n").unwrap();
        write!(temp_file, "--{boundary}--\r\n").unwrap();
        drop(temp_file);

        let parsed = parse_executor_response_file(&temp_path, boundary).expect("failed to parse multipart file");
        std::fs::remove_file(&temp_path).unwrap();

        assert_eq!(parsed.status_code, 201);
        assert_eq!(
            parsed.response_headers.get("content-type"),
            Some(&"application/octet-stream".to_string())
        );

        let (body_start, body_end) = parsed.body_range.expect("missing body range");
        assert_eq!(body_end - body_start, body_payload.len() as u64);
    }
}
