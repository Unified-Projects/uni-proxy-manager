use crate::db::RouteInfo;
use redis::AsyncCommands;

const CACHE_PREFIX: &str = "sites:route:";

/// Get route info from cache
pub async fn get_cached_route(
    redis: &mut redis::aio::ConnectionManager,
    hostname: &str,
) -> Option<RouteInfo> {
    let key = format!("{}{}", CACHE_PREFIX, hostname);

    let result: Result<Option<String>, _> = redis.get(&key).await;

    match result {
        Ok(Some(json)) => serde_json::from_str(&json).ok(),
        _ => None,
    }
}

/// Set route info in cache
pub async fn set_cached_route(
    redis: &mut redis::aio::ConnectionManager,
    hostname: &str,
    route: &RouteInfo,
    ttl_seconds: u64,
) -> Result<(), redis::RedisError> {
    let key = format!("{}{}", CACHE_PREFIX, hostname);
    let json = serde_json::to_string(route).map_err(|e| {
        redis::RedisError::from((
            redis::ErrorKind::UnexpectedReturnType,
            "JSON serialization error",
            e.to_string(),
        ))
    })?;

    redis.set_ex(&key, json, ttl_seconds).await
}

/// Invalidate cache for a hostname
pub async fn invalidate_hostname(
    redis: &mut redis::aio::ConnectionManager,
    hostname: &str,
) -> Result<(), redis::RedisError> {
    let key = format!("{}{}", CACHE_PREFIX, hostname);
    redis.del(&key).await
}

/// Invalidate cache for multiple hostnames
pub async fn invalidate_hostnames(
    redis: &mut redis::aio::ConnectionManager,
    hostnames: &[String],
) -> Result<u64, redis::RedisError> {
    if hostnames.is_empty() {
        return Ok(0);
    }

    let keys: Vec<String> = hostnames
        .iter()
        .map(|h| format!("{}{}", CACHE_PREFIX, h))
        .collect();

    redis.del(&keys).await
}

/// Invalidate all cache entries for a site (by querying hostnames)
pub async fn invalidate_site(
    pool: &sqlx::PgPool,
    redis: &mut redis::aio::ConnectionManager,
    site_id: &str,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    // Query all hostnames for this site
    let hostnames: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT d.hostname
        FROM site_domains sd
        JOIN domains d ON d.id = sd.domain_id
        WHERE sd.site_id = $1
        "#
    )
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    if hostnames.is_empty() {
        return Ok(0);
    }

    let count = invalidate_hostnames(redis, &hostnames).await?;
    Ok(count)
}
