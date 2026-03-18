use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::time::{SystemTime, UNIX_EPOCH};

/// Data for tracking a page view
#[allow(dead_code)]
pub struct PageViewData {
    pub site_id: String,
    pub domain_id: String,
    pub deployment_id: String,
    pub domain: String,
    pub path: String,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
    pub country: Option<String>,
    pub response_code: u16,
    pub response_time_ms: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub visitor_id: String,
}

fn get_minute_bucket(timestamp_ms: u64) -> u64 {
    // Round down to the nearest minute
    (timestamp_ms / 60000) * 60000
}

fn parse_device_type(user_agent: &str) -> &'static str {
    let ua = user_agent.to_lowercase();
    if ua.contains("tablet") || ua.contains("ipad") {
        "tablet"
    } else if ua.contains("mobile") || ua.contains("iphone") || ua.contains("android") {
        "mobile"
    } else if ua.contains("windows") || ua.contains("macintosh") || ua.contains("linux") {
        "desktop"
    } else {
        "other"
    }
}

fn extract_referrer_domain(referrer: &str) -> Option<String> {
    if referrer.is_empty() {
        return None;
    }

    // Parse the URL to extract hostname
    if let Some(start) = referrer.find("://") {
        let after_scheme = &referrer[start + 3..];
        let end = after_scheme.find('/').unwrap_or(after_scheme.len());
        let host = &after_scheme[..end];
        // Remove port if present
        let host = host.split(':').next().unwrap_or(host);
        if !host.is_empty() {
            return Some(host.to_string());
        }
    }
    None
}

/// Track a page view for analytics
/// Stores metrics in Redis for periodic aggregation into the database
pub async fn track_page_view(
    redis: &mut ConnectionManager,
    data: PageViewData,
) -> Result<(), redis::RedisError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let minute_bucket = get_minute_bucket(now);
    let domain = &data.domain;
    let site_id = &data.site_id;

    // Site-level metrics key
    let site_metrics_key = format!("site-metrics:{}:{}", site_id, minute_bucket);
    // Domain-specific metrics key
    let domain_metrics_key = format!("site-metrics:{}:{}:{}", site_id, domain, minute_bucket);

    // Use a pipeline for efficiency
    let mut pipe = redis::pipe();

    // Increment page views and bytes for both site and domain
    pipe.hincr(&site_metrics_key, "page_views", 1i64);
    pipe.hincr(&site_metrics_key, "bytes_in", data.bytes_in as i64);
    pipe.hincr(&site_metrics_key, "bytes_out", data.bytes_out as i64);
    pipe.hincr(&domain_metrics_key, "page_views", 1i64);
    pipe.hincr(&domain_metrics_key, "bytes_in", data.bytes_in as i64);
    pipe.hincr(&domain_metrics_key, "bytes_out", data.bytes_out as i64);

    // Track response codes for both
    let status_field = match data.response_code {
        200..=299 => "responses_2xx",
        300..=399 => "responses_3xx",
        400..=499 => "responses_4xx",
        500..=599 => "responses_5xx",
        _ => "responses_other",
    };
    pipe.hincr(&site_metrics_key, status_field, 1i64);
    pipe.hincr(&domain_metrics_key, status_field, 1i64);

    // Track unique visitors - both site and domain level
    let site_unique_key = format!("site-unique-visitors:{}:{}", site_id, minute_bucket);
    let domain_unique_key = format!("site-unique-visitors:{}:{}:{}", site_id, domain, minute_bucket);

    // Check membership BEFORE sadd so we can accurately detect new visitors
    let site_is_new: bool = !redis.sismember(&site_unique_key, &data.visitor_id).await.unwrap_or(false);
    let domain_is_new: bool = !redis.sismember(&domain_unique_key, &data.visitor_id).await.unwrap_or(false);

    pipe.sadd(&site_unique_key, &data.visitor_id);
    pipe.sadd(&domain_unique_key, &data.visitor_id);
    pipe.expire(&site_unique_key, 120);
    pipe.expire(&domain_unique_key, 120);

    if site_is_new {
        pipe.hincr(&site_metrics_key, "unique_visitors", 1i64);
    }
    if domain_is_new {
        pipe.hincr(&domain_metrics_key, "unique_visitors", 1i64);
    }

    // Track paths - both levels
    let site_paths_key = format!("site-paths:{}:{}", site_id, minute_bucket);
    let domain_paths_key = format!("site-paths:{}:{}:{}", site_id, domain, minute_bucket);
    pipe.hincr(&site_paths_key, &data.path, 1i64);
    pipe.hincr(&domain_paths_key, &data.path, 1i64);
    pipe.expire(&site_paths_key, 120);
    pipe.expire(&domain_paths_key, 120);

    // Track referrers - both levels
    if let Some(ref referrer) = data.referrer {
        if let Some(referrer_domain) = extract_referrer_domain(referrer) {
            let site_referrers_key = format!("site-referrers:{}:{}", site_id, minute_bucket);
            let domain_referrers_key = format!("site-referrers:{}:{}:{}", site_id, domain, minute_bucket);
            pipe.hincr(&site_referrers_key, &referrer_domain, 1i64);
            pipe.hincr(&domain_referrers_key, &referrer_domain, 1i64);
            pipe.expire(&site_referrers_key, 120);
            pipe.expire(&domain_referrers_key, 120);
        }
    }

    // Track devices - both levels
    let device = parse_device_type(data.user_agent.as_deref().unwrap_or(""));
    let site_devices_key = format!("site-devices:{}:{}", site_id, minute_bucket);
    let domain_devices_key = format!("site-devices:{}:{}:{}", site_id, domain, minute_bucket);
    pipe.hincr(&site_devices_key, device, 1i64);
    pipe.hincr(&domain_devices_key, device, 1i64);
    pipe.expire(&site_devices_key, 120);
    pipe.expire(&domain_devices_key, 120);

    // Track geo - both levels
    if let Some(ref country) = data.country {
        let site_geo_key = format!("site-geo:{}:{}", site_id, minute_bucket);
        let domain_geo_key = format!("site-geo:{}:{}:{}", site_id, domain, minute_bucket);
        pipe.hincr(&site_geo_key, country, 1i64);
        pipe.hincr(&domain_geo_key, country, 1i64);
        pipe.expire(&site_geo_key, 120);
        pipe.expire(&domain_geo_key, 120);
    }

    // Track active visitors - both site and domain level (using HyperLogLog)
    let site_active_visitors_key = format!("site-active-visitors:{}", site_id);
    let domain_active_visitors_key = format!("site-active-visitors:{}:{}", site_id, domain);
    pipe.pfadd(&site_active_visitors_key, &data.visitor_id);
    pipe.pfadd(&domain_active_visitors_key, &data.visitor_id);
    pipe.expire(&site_active_visitors_key, 300);
    pipe.expire(&domain_active_visitors_key, 300);

    // Set TTL on metrics keys
    pipe.expire(&site_metrics_key, 120);
    pipe.expire(&domain_metrics_key, 120);

    // Execute the pipeline
    pipe.query_async::<()>(redis).await?;

    // Update response time average for site
    let current_site_avg: i64 = redis.hget(&site_metrics_key, "avg_response_time_ms").await.unwrap_or(0);
    let current_site_count: i64 = redis.hget(&site_metrics_key, "page_views").await.unwrap_or(1);
    let new_site_avg = if current_site_count > 0 {
        ((current_site_avg * (current_site_count - 1)) + data.response_time_ms as i64) / current_site_count
    } else {
        data.response_time_ms as i64
    };
    let _: () = redis.hset(&site_metrics_key, "avg_response_time_ms", new_site_avg).await?;

    // Update response time average for domain
    let current_domain_avg: i64 = redis.hget(&domain_metrics_key, "avg_response_time_ms").await.unwrap_or(0);
    let current_domain_count: i64 = redis.hget(&domain_metrics_key, "page_views").await.unwrap_or(1);
    let new_domain_avg = if current_domain_count > 0 {
        ((current_domain_avg * (current_domain_count - 1)) + data.response_time_ms as i64) / current_domain_count
    } else {
        data.response_time_ms as i64
    };
    let _: () = redis.hset(&domain_metrics_key, "avg_response_time_ms", new_domain_avg).await?;

    Ok(())
}

/// Generate a visitor ID from client IP (hashed for privacy)
pub fn generate_visitor_id(client_ip: &str, user_agent: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    client_ip.hash(&mut hasher);
    user_agent.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}
