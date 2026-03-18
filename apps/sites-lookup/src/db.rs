use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::PgPool;

/// Route information returned by lookup
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteInfo {
    pub runtime_id: String,
    pub image: String,
    pub source: String,
    pub entrypoint: String,
    pub variables: serde_json::Map<String, JsonValue>,
    pub timeout: i32,
    pub cpus: f64,
    pub memory: i32,
    pub render_mode: String,
    pub site_id: String,
    pub deployment_id: String,
    pub domain_id: String,
}

/// Domain record from database
#[derive(Debug, sqlx::FromRow)]
struct DomainRow {
    id: String,
}

/// Site domain record from database
#[derive(Debug, sqlx::FromRow)]
struct SiteDomainRow {
    site_id: String,
    deployment_id: Option<String>,
}

/// Site record from database
#[derive(Debug, sqlx::FromRow)]
struct SiteRow {
    id: String,
    framework: String,
    render_mode: String,
    node_version: Option<String>,
    env_variables: Option<JsonValue>,
    runtime_path: Option<String>,
    entry_point: Option<String>,
    memory_mb: i32,
    cpu_limit: rust_decimal::Decimal,
    timeout_seconds: i32,
    active_deployment_id: Option<String>,
}

/// Deployment record from database
#[derive(Debug, sqlx::FromRow)]
struct DeploymentRow {
    id: String,
    status: String,
    artifact_path: Option<String>,
}

/// Lookup route info by hostname
pub async fn lookup_route(pool: &PgPool, hostname: &str) -> Result<Option<RouteInfo>, sqlx::Error> {
    tracing::info!("DB lookup for hostname: {}", hostname);

    // 1. Find domain by hostname (don't require 'active' status - site deployment status is what matters)
    let domain: Option<DomainRow> = sqlx::query_as(
        "SELECT id FROM domains WHERE hostname = $1 AND status != 'disabled'"
    )
    .bind(hostname)
    .fetch_optional(pool)
    .await?;

    let domain = match domain {
        Some(d) => {
            tracing::info!("Found domain: id={}", d.id);
            d
        }
        None => {
            tracing::warn!("No domain found for hostname: {} (or status is disabled)", hostname);
            return Ok(None);
        }
    };

    // 2. Find active site domain
    let site_domain: Option<SiteDomainRow> = sqlx::query_as(
        "SELECT site_id, deployment_id FROM site_domains WHERE domain_id = $1 AND is_active = true"
    )
    .bind(&domain.id)
    .fetch_optional(pool)
    .await?;

    let site_domain = match site_domain {
        Some(sd) => {
            tracing::info!("Found site_domain: site_id={}, deployment_id={:?}", sd.site_id, sd.deployment_id);
            sd
        }
        None => {
            tracing::warn!("No active site_domain found for domain_id: {}", domain.id);
            return Ok(None);
        }
    };

    // 3. Get site configuration (cast enums to text for compatibility)
    let site: Option<SiteRow> = sqlx::query_as(
        r#"SELECT
            id, framework::text as framework, render_mode::text as render_mode,
            node_version, env_variables,
            runtime_path, entry_point, memory_mb, cpu_limit, timeout_seconds,
            active_deployment_id
        FROM sites WHERE id = $1"#
    )
    .bind(&site_domain.site_id)
    .fetch_optional(pool)
    .await?;

    let site = match site {
        Some(s) => {
            tracing::info!("Found site: id={}, active_deployment_id={:?}", s.id, s.active_deployment_id);
            s
        }
        None => {
            tracing::warn!("No site found for site_id: {}", site_domain.site_id);
            return Ok(None);
        }
    };

    // 4. Determine deployment ID (site_domain overrides site's active deployment)
    let deployment_id = site_domain.deployment_id
        .or(site.active_deployment_id.clone());

    let deployment_id = match deployment_id {
        Some(id) => {
            tracing::info!("Using deployment_id: {}", id);
            id
        }
        None => {
            tracing::warn!("No deployment_id found for site: {}", site.id);
            return Ok(None);
        }
    };

    // 5. Verify deployment is live (cast enum to text)
    let deployment: Option<DeploymentRow> = sqlx::query_as(
        "SELECT id, status::text as status, artifact_path FROM deployments WHERE id = $1"
    )
    .bind(&deployment_id)
    .fetch_optional(pool)
    .await?;

    let deployment = match deployment {
        Some(d) => {
            tracing::info!("Found deployment: id={}, status={}", d.id, d.status);
            if d.status == "live" {
                d
            } else {
                tracing::warn!("Deployment {} status is '{}', not 'live'", d.id, d.status);
                return Ok(None);
            }
        }
        None => {
            tracing::warn!("No deployment found for deployment_id: {}", deployment_id);
            return Ok(None);
        }
    };

    // Build route info
    let runtime_id = format!("{}-{}", site.id, deployment.id);

    // Determine runtime image
    let node_version = site.node_version.unwrap_or_else(|| "20".to_string());
    let major_version: i32 = node_version.split('.').next()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);

    let runtime_node_version = if major_version >= 22 {
        major_version.to_string()
    } else if node_version.contains('.') {
        node_version.clone()
    } else {
        format!("{}.0", node_version)
    };

    let image = format!("openruntimes/node:v5-{}", runtime_node_version);

    // Source path: derive from artifact_path column to support both local and S3 modes
    let source = match deployment.artifact_path.as_deref() {
        Some(p) if p.starts_with("local:") => p[6..].to_string(),
        Some(p) if !p.is_empty() => p.to_string(),
        _ => format!("/storage/functions/{}/artifact.tar.gz", deployment.id),
    };

    // Determine entrypoint
    let render_mode = site.render_mode.clone();
    let is_static = render_mode == "ssg";
    let entry_point = site.entry_point.clone().unwrap_or_default();
    let runtime_path = site.runtime_path.clone().unwrap_or_default();

    let start_command = build_start_command(
        &entry_point,
        &runtime_path,
        &site.framework,
        is_static,
    );

    let escaped_start_command = start_command.replace('"', "\\\"");
    let entrypoint = format!(
        "cp /tmp/code.tar.gz /mnt/code/code.tar.gz && nohup helpers/start.sh \"{}\"",
        escaped_start_command
    );

    // Build variables
    let mut variables = match site.env_variables {
        Some(JsonValue::Object(map)) => map,
        _ => serde_json::Map::new(),
    };

    if is_static {
        variables.insert(
            "OPEN_RUNTIMES_STATIC_FALLBACK".to_string(),
            JsonValue::String("index.html".to_string()),
        );
    }

    // Convert cpu_limit to f64
    let cpus: f64 = site.cpu_limit.to_string().parse().unwrap_or(0.5);

    Ok(Some(RouteInfo {
        runtime_id,
        image,
        source,
        entrypoint,
        variables,
        timeout: site.timeout_seconds,
        cpus,
        memory: site.memory_mb,
        render_mode,
        site_id: site.id,
        deployment_id: deployment.id,
        domain_id: domain.id,
    }))
}

/// Build the start command based on framework and configuration
fn build_start_command(
    entry_point: &str,
    runtime_path: &str,
    framework: &str,
    is_static: bool,
) -> String {
    // If entry_point contains whitespace, it's a full command
    if !entry_point.is_empty() && entry_point.contains(char::is_whitespace) {
        return entry_point.to_string();
    }

    // If entry_point is set (but no whitespace), construct node command
    if !entry_point.is_empty() {
        return if !runtime_path.is_empty() {
            format!("cd {} && node {}", runtime_path, entry_point)
        } else {
            format!("node {}", entry_point)
        };
    }

    // Default commands based on framework
    match framework {
        "nextjs" => {
            if is_static {
                "bash helpers/server.sh".to_string()
            } else {
                "bash helpers/next-js/server.sh".to_string()
            }
        }
        "sveltekit" => {
            if is_static {
                "bash helpers/server.sh".to_string()
            } else {
                "bash helpers/sveltekit/server.sh".to_string()
            }
        }
        _ => "bash helpers/server.sh".to_string(),
    }
}
