import { join } from "path";

// Set environment variables for tests before any imports
process.env.NODE_ENV = "test";
process.env.UNI_PROXY_MANAGER_AUTH_ENABLED = "false";

// Detect if running inside Docker (test-runner container sets these)
const isDocker = !!process.env.DATABASE_URL?.includes("test-postgres");

// Use environment variables if set (Docker), otherwise use localhost defaults
const POSTGRES_HOST = isDocker ? "test-postgres" : "localhost";
const POSTGRES_PORT = isDocker ? "5432" : "5433";
const REDIS_HOST = isDocker ? "test-redis" : "localhost";
const REDIS_PORT = isDocker ? "6379" : "6382";
const MINIO_HOST = isDocker ? "test-minio" : "localhost";
const EXECUTOR_HOST = isDocker ? "test-executor" : "localhost";
const EXECUTOR_PORT = isDocker ? "80" : "9900";
const POMERIUM_HOST = isDocker ? "test-pomerium" : "localhost";
const POMERIUM_PORT = isDocker ? "80" : "5080";
const DEX_HOST = isDocker ? "test-dex" : "localhost";
const DEX_PORT = isDocker ? "5556" : "5556";

// Database URL with sslmode=disable for test postgres without TLS
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    `postgresql://test_user:test_password@${POSTGRES_HOST}:${POSTGRES_PORT}/uni_proxy_manager_test?sslmode=disable`;
}
process.env.UNI_PROXY_MANAGER_DB_URL = process.env.DATABASE_URL;

// Redis URL
if (!process.env.UNI_PROXY_MANAGER_REDIS_URL) {
  process.env.UNI_PROXY_MANAGER_REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
}

// HAProxy paths - point to test Docker volumes
const PROJECT_ROOT = isDocker ? "/app" : process.cwd();
const TEST_DATA_DIR = join(PROJECT_ROOT, "docker", "test-data");

process.env.UNI_PROXY_MANAGER_HAPROXY_SOCKET = "/var/run/haproxy/haproxy.sock";
if (!process.env.UNI_PROXY_MANAGER_HAPROXY_CONFIG_PATH) {
  process.env.UNI_PROXY_MANAGER_HAPROXY_CONFIG_PATH = join(TEST_DATA_DIR, "haproxy", "haproxy.cfg");
}

// File paths - use test directories
if (!process.env.UNI_PROXY_MANAGER_CERTS_DIR) {
  process.env.UNI_PROXY_MANAGER_CERTS_DIR = join(TEST_DATA_DIR, "certificates");
}
if (!process.env.UNI_PROXY_MANAGER_ERROR_PAGES_DIR) {
  process.env.UNI_PROXY_MANAGER_ERROR_PAGES_DIR = join(TEST_DATA_DIR, "error-pages");
}

// =============================================================================
// Pebble ACME Test Server Configuration
// =============================================================================

const PEBBLE_HOST = isDocker ? "test-pebble" : "localhost";

// Use Pebble as the ACME server for testing
// Pebble auto-validates all challenges with PEBBLE_VA_ALWAYS_VALID=1
if (!process.env.ACME_DIRECTORY_URL) {
  process.env.ACME_DIRECTORY_URL = `https://${PEBBLE_HOST}:14000/dir`;
}

// Disable TLS verification for Pebble's self-signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ACME settings
process.env.UNI_PROXY_MANAGER_ACME_EMAIL = "test@example.com";
process.env.UNI_PROXY_MANAGER_ACME_STAGING = "true";

// Enable Sites extension for testing by setting required config
// Sites extension auto-detects based on executor or S3 being configured
if (!process.env.SITES_S3_ENDPOINT) {
  process.env.SITES_S3_ENDPOINT = `http://${MINIO_HOST}:9000`;
}
if (!process.env.SITES_S3_BUCKET) {
  process.env.SITES_S3_BUCKET = "test-bucket";
}
if (!process.env.SITES_S3_ACCESS_KEY) {
  process.env.SITES_S3_ACCESS_KEY = "minioadmin";
}
if (!process.env.SITES_S3_SECRET_KEY) {
  process.env.SITES_S3_SECRET_KEY = "minioadmin";
}
if (!process.env.SITES_S3_REGION) {
  process.env.SITES_S3_REGION = "us-east-1";
}

// Sites source directory - use test data directory
if (!process.env.SITES_SOURCE_DIR) {
  process.env.SITES_SOURCE_DIR = join(TEST_DATA_DIR, "sites", "sources");
}

// OpenRuntimes executor configuration
if (!process.env.SITES_EXECUTOR_ENDPOINT) {
  process.env.SITES_EXECUTOR_ENDPOINT = `http://${EXECUTOR_HOST}:${EXECUTOR_PORT}`;
}
if (!process.env.SITES_EXECUTOR_SECRET) {
  process.env.SITES_EXECUTOR_SECRET = "test-executor-secret";
}

// Build directory for tests
if (!process.env.SITES_BUILD_DIR) {
  process.env.SITES_BUILD_DIR = join(TEST_DATA_DIR, "sites", "builds");
}
if (!process.env.SITES_DEPLOY_DIR) {
  process.env.SITES_DEPLOY_DIR = join(TEST_DATA_DIR, "sites", "deploys");
}

// =============================================================================
// Pomerium Extension Configuration
// =============================================================================

// Enable Pomerium extension for testing
process.env.UNI_PROXY_MANAGER_POMERIUM_ENABLED = "true";

// Pomerium configuration paths
if (!process.env.POMERIUM_CONFIG_PATH) {
  process.env.POMERIUM_CONFIG_PATH = join(TEST_DATA_DIR, "pomerium", "policy.yaml");
}
if (!process.env.POMERIUM_INTERNAL_URL) {
  process.env.POMERIUM_INTERNAL_URL = `http://${POMERIUM_HOST}:${POMERIUM_PORT}`;
}

// =============================================================================
// Dex OIDC Provider Configuration (for real auth testing)
// =============================================================================

// Dex OIDC issuer URL
if (!process.env.DEX_ISSUER_URL) {
  process.env.DEX_ISSUER_URL = `http://${DEX_HOST}:${DEX_PORT}/dex`;
}

// Pomerium URLs for testing
process.env.POMERIUM_URL = `http://${POMERIUM_HOST}:${POMERIUM_PORT}`;
process.env.POMERIUM_AUTHENTICATE_URL = `http://${POMERIUM_HOST}:${POMERIUM_PORT}`;
process.env.POMERIUM_FORWARD_AUTH_URL = `http://${POMERIUM_HOST}:${POMERIUM_PORT}/.pomerium/verify`;

// Test Pomerium OIDC client credentials (matching Dex config)
process.env.POMERIUM_IDP_CLIENT_ID = "pomerium-test";
process.env.POMERIUM_IDP_CLIENT_SECRET = "pomerium-test-secret";

// Cookie and shared secrets for Pomerium (base64 encoded 32-byte secrets)
process.env.POMERIUM_COOKIE_SECRET = "V2JBZHk2a3NNQW5ScG9IY25JNzdLcXppSVByS09Qdmo=";
process.env.POMERIUM_SHARED_SECRET = "V2JBZHk2a3NNQW5ScG9IY25JNzdLcXppSVByS09Qdmo=";

// Flag to control whether to wait for Dex/Pomerium during test setup
// Set to "false" to skip Pomerium container waiting (for tests not needing auth)
process.env.TEST_POMERIUM_ENABLED = "true";
