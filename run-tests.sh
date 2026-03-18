#!/bin/bash

# Domain Analytics Test Runner
# Runs domain analytics integration tests with Docker setup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --all                 Run unit tests + all integration tests (default)"
    echo "  --domain-analytics    Run only domain analytics integration tests"
    echo "  --pomerium            Run only Pomerium integration tests (api/pomerium + pomerium/)"
    echo "  --docker-up           Start Docker containers only"
    echo "  --docker-down         Stop Docker containers only"
    echo "  --help                Show this help message"
    echo ""
}

cleanup() {
    echo -e "${YELLOW}[Tests] Cleaning up...${NC}"
    cd "$PROJECT_ROOT"
    pnpm test:docker:down 2>/dev/null || true
}

# Parse arguments
RUN_DOMAIN_ANALYTICS=false
RUN_POMERIUM=false
RUN_ALL=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --domain-analytics)
            RUN_DOMAIN_ANALYTICS=true
            RUN_ALL=false
            shift
            ;;
        --pomerium)
            RUN_POMERIUM=true
            RUN_ALL=false
            shift
            ;;
        --all)
            RUN_DOMAIN_ANALYTICS=false
            RUN_ALL=true
            shift
            ;;
        --docker-up)
            echo -e "${YELLOW}[Tests] Starting Docker containers...${NC}"
            cd "$PROJECT_ROOT"
            pnpm test:docker:up
            exit 0
            ;;
        --docker-down)
            echo -e "${YELLOW}[Tests] Stopping Docker containers...${NC}"
            cd "$PROJECT_ROOT"
            pnpm test:docker:down
            exit 0
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}[Tests] Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

cd "$PROJECT_ROOT"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[Tests] Installing dependencies...${NC}"
    pnpm install
fi

# Register cleanup on exit
trap cleanup EXIT

# Run unit tests first, before any Docker env vars are exported
# (unit tests test default/fallback values and must not see Docker-specific env)
if [ "$RUN_ALL" = true ]; then
    echo -e "${GREEN}[Tests] Running unit tests...${NC}"
    if ! pnpm exec vitest run --config vitest.config.unit.ts; then
        echo -e "${RED}[Tests] Unit tests failed.${NC}"
        exit 1
    fi
    echo -e "${GREEN}[Tests] Unit tests passed!${NC}"
fi

# Stop any existing test containers
echo -e "${YELLOW}[Tests] Stopping any existing test containers...${NC}"
pnpm test:docker:down 2>/dev/null || true

# Create test-data files that are gitignored but required by containers
mkdir -p "$PROJECT_ROOT/docker/test-data/analytics-website"
cat > "$PROJECT_ROOT/docker/test-data/analytics-website/index.html" <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Website Home</title>
  <script src="script.js"></script>
</head>
<body>
  <h1>Test Website Home</h1>
  <p>This page is used for integration testing of the analytics pipeline.</p>
</body>
</html>
EOF
cat > "$PROJECT_ROOT/docker/test-data/analytics-website/about.html" <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Website About</title>
</head>
<body>
  <h1>Test Website About</h1>
  <p>About page for analytics integration testing.</p>
</body>
</html>
EOF
cat > "$PROJECT_ROOT/docker/test-data/analytics-website/noscript.html" <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Website Noscript</title>
</head>
<body>
  <h1>Test Website Noscript</h1>
  <noscript><img src="pixel.gif" width="1" height="1" alt="" /></noscript>
</body>
</html>
EOF

# Start test containers
echo -e "${YELLOW}[Tests] Starting test containers...${NC}"
pnpm test:docker:up

# Wait for containers to be healthy (--wait flag in docker:up waits for healthchecks)
echo -e "${YELLOW}[Tests] Waiting for containers to be healthy...${NC}"
echo -e "${YELLOW}[Tests] This may take a few minutes for dependencies to install...${NC}"

# Export Docker container environment variables for integration test execution
export DATABASE_URL="postgresql://test_user:test_password@test-postgres:5432/uni_proxy_manager_test?sslmode=disable"
export UNI_PROXY_MANAGER_DB_URL="$DATABASE_URL"
export UNI_PROXY_MANAGER_REDIS_URL="redis://test-redis:6379"
export SITES_S3_ENDPOINT="http://test-minio:9000"
export SITES_S3_BUCKET="test-bucket"
export SITES_S3_ACCESS_KEY="minioadmin"
export SITES_S3_SECRET_KEY="minioadmin"
export SITES_S3_REGION="us-east-1"
export SITES_EXECUTOR_ENDPOINT="http://test-executor:80"
export SITES_EXECUTOR_SECRET="test-executor-secret"
export POMERIUM_INTERNAL_URL="http://test-pomerium:80"
export POMERIUM_URL="http://test-pomerium:80"
export DEX_ISSUER_URL="http://test-dex:5556/dex"
export NODE_TLS_REJECT_UNAUTHORIZED="0"
export ACME_DIRECTORY_URL="https://test-pebble:14000/dir"

# Set Pomerium config path
export POMERIUM_CONFIG_PATH="$PROJECT_ROOT/docker/test-data/pomerium/policy.yaml"
export UNI_PROXY_MANAGER_HAPROXY_CONFIG_PATH="$PROJECT_ROOT/docker/test-data/haproxy/haproxy.cfg"
export UNI_PROXY_MANAGER_CERTS_DIR="$PROJECT_ROOT/docker/test-data/certificates"
export UNI_PROXY_MANAGER_ERROR_PAGES_DIR="$PROJECT_ROOT/docker/test-data/error-pages"
export SITES_SOURCE_DIR="$PROJECT_ROOT/docker/test-data/sites/sources"
export SITES_BUILD_DIR="$PROJECT_ROOT/docker/test-data/sites/builds"
export SITES_DEPLOY_DIR="$PROJECT_ROOT/docker/test-data/sites/deploys"

echo -e "${GREEN}[Tests] Environment configured for Docker test containers${NC}"

# Run integration tests INSIDE the test-runner container where Docker DNS works
if [ "$RUN_DOMAIN_ANALYTICS" = true ]; then
    echo -e "${GREEN}[Tests] Running domain analytics integration tests inside test-runner container...${NC}"
    if docker exec uni-proxy-manager-test-runner pnpm exec vitest run --config vitest.config.integration.ts tests/integration/workers/domain-analytics.test.ts; then
        echo -e "${GREEN}[Tests] Domain analytics tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}[Tests] Domain analytics tests failed.${NC}"
        exit 1
    fi
elif [ "$RUN_POMERIUM" = true ]; then
    echo -e "${GREEN}[Tests] Running Pomerium integration tests inside test-runner container...${NC}"
    if docker exec uni-proxy-manager-test-runner pnpm exec vitest run \
        --config vitest.config.integration.ts \
        tests/integration/api/pomerium \
        tests/integration/pomerium \
        tests/integration/workers/pomerium-config.test.ts \
        tests/integration/workers/pomerium-restart.test.ts; then
        echo -e "${GREEN}[Tests] Pomerium tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}[Tests] Pomerium tests failed.${NC}"
        exit 1
    fi
elif [ "$RUN_ALL" = true ]; then
    echo -e "${GREEN}[Tests] Running all integration tests inside test-runner container...${NC}"
    # SKIP_URT_TESTS=true: URT executor requires Docker-in-Docker with functional runtimes.
    # Run URT tests explicitly with ./run-tests.sh --urt when that environment is available.
    if docker exec -e SKIP_URT_TESTS=true uni-proxy-manager-test-runner pnpm exec vitest run --config vitest.config.integration.ts; then
        echo -e "${GREEN}[Tests] All integration tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}[Tests] Some integration tests failed.${NC}"
        exit 1
    fi
fi
