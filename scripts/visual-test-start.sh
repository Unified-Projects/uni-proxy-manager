#!/bin/bash

# Visual Test Environment Starter
# Starts all services and seeds the database with test data for manual testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}=====================================${NC}"
echo -e "${CYAN}  Visual Testing Environment Setup   ${NC}"
echo -e "${CYAN}=====================================${NC}"
echo ""

cd "$PROJECT_ROOT"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}[Error] Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Stop any existing containers
echo -e "${YELLOW}[1/8] Stopping any existing test containers...${NC}"
docker compose -f docker/docker-compose.visual-test.yml down -v 2>/dev/null || true

# Create test data directories
echo -e "${YELLOW}[2/8] Creating test data directories...${NC}"
mkdir -p docker/visual-test-data/haproxy
mkdir -p docker/visual-test-data/certificates
mkdir -p docker/visual-test-data/error-pages
mkdir -p docker/visual-test-data/nginx
mkdir -p docker/visual-test-data/sites
# OpenRuntimes storage directories (host paths for bind mounts)
mkdir -p /tmp/uni-proxy-visual/builds
mkdir -p /tmp/uni-proxy-visual/functions

# Write initial HAProxy config
cat > docker/visual-test-data/haproxy/haproxy.cfg << 'EOF'
global
    log stdout format raw local0
    maxconn 4096
    stats socket /var/run/haproxy/haproxy.sock mode 666 level admin expose-fd listeners
    stats timeout 30s

defaults
    log global
    mode http
    option httplog
    option forwardfor
    timeout connect 5s
    timeout client 30s
    timeout server 30s

# Stats frontend for health checks and monitoring
frontend stats_front
    bind *:8404
    mode http
    stats enable
    stats uri /stats
    stats refresh 10s
    stats admin if TRUE

frontend http_front
    bind *:80
    mode http

    # ACL for API routes
    acl is_api path_beg /api

    # Route API requests to containerized API
    use_backend api_backend if is_api

    # Route everything else to containerized web dashboard
    default_backend web_backend

backend api_backend
    mode http
    balance roundrobin
    server api visual-api:3001 check

backend web_backend
    mode http
    balance roundrobin
    server web visual-web:3000 check

backend test_backend
    mode http
    balance roundrobin
    server test-backend-1 test-backend:80 check
    server test-backend-2 test-backend-2:80 check
    server test-backend-3 test-backend-3:80 check
EOF

# Write nginx index for test backend
cat > docker/visual-test-data/nginx/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head><title>Test Backend</title></head>
<body>
<h1>Test Backend Server</h1>
<p>This is the test backend server for visual testing.</p>
<p>Timestamp: <script>document.write(new Date().toISOString())</script></p>
</body>
</html>
EOF

# Start containers (always rebuild to pick up code changes)
echo -e "${YELLOW}[3/8] Building and starting Docker containers...${NC}"
docker compose -f docker/docker-compose.visual-test.yml build --no-cache
docker compose -f docker/docker-compose.visual-test.yml up -d

# Wait for containers to be healthy
echo -e "${YELLOW}[4/8] Waiting for containers to be healthy...${NC}"
sleep 3

# Wait for PostgreSQL
echo -n "  Waiting for PostgreSQL..."
for i in {1..30}; do
    if docker exec uni-proxy-visual-postgres pg_isready -U visual_user -d uni_proxy_visual > /dev/null 2>&1; then
        echo -e " ${GREEN}Ready${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Wait for Redis
echo -n "  Waiting for Redis..."
for i in {1..30}; do
    if docker exec uni-proxy-visual-redis redis-cli ping > /dev/null 2>&1; then
        echo -e " ${GREEN}Ready${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Wait for MinIO
echo -n "  Waiting for MinIO..."
for i in {1..30}; do
    if curl -s http://localhost:9000/minio/health/live > /dev/null 2>&1; then
        echo -e " ${GREEN}Ready${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Wait for OpenRuntimes executor
echo -n "  Waiting for OpenRuntimes..."
for i in {1..30}; do
    if docker exec uni-proxy-visual-openruntimes curl -s http://localhost:80/v1/health > /dev/null 2>&1; then
        echo -e " ${GREEN}Ready${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Setup MinIO bucket for Sites
echo -e "${YELLOW}[5/8] Setting up MinIO bucket for Sites...${NC}"
docker run --rm --network uni-proxy-visual-network \
    -e MC_HOST_minio=http://minioadmin:minioadmin@visual-minio:9000 \
    minio/mc:latest mb --ignore-existing minio/sites-artifacts
echo -e "  ${GREEN}Created bucket: sites-artifacts${NC}"

# Run database migrations
echo -e "${YELLOW}[6/8] Running database migrations...${NC}"
UNI_PROXY_MANAGER_DB_URL="postgresql://visual_user:visual_password@localhost:5434/uni_proxy_visual?sslmode=disable" \
    pnpm db:push

# Seed the database
echo -e "${YELLOW}[7/8] Seeding database with test data...${NC}"
npx tsx scripts/seed-visual-test.ts

# Create OpenRuntimes network if needed
echo -e "${YELLOW}[8/8] Setting up OpenRuntimes network...${NC}"
docker network create uni-proxy-visual-openruntimes-network 2>/dev/null || true
echo -e "  ${GREEN}OpenRuntimes network ready${NC}"

echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  Visual Testing Environment Ready!  ${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "${GREEN}Access the dashboard:${NC}"
echo -e "  ${CYAN}http://localhost${NC} (via HAProxy on port 80)"
echo ""
echo -e "${GREEN}MinIO Console:${NC}"
echo -e "  ${CYAN}http://localhost:9001${NC} (user: minioadmin, password: minioadmin)"
echo ""
echo -e "All services containerized:"
echo -e "  - HAProxy (port 80 exposed)"
echo -e "  - PostgreSQL, Redis"
echo -e "  - Web Dashboard, API Server"
echo -e "  - Test Backends"
echo -e "  - MinIO (S3 Storage - ports 9000/9001)"
echo -e "  - OpenRuntimes Executor"
echo ""
echo -e "Test Data:"
echo -e "  - 4 Domains, 6 Backends, 3 Error Pages"
echo -e "  - 2 DNS Providers, 3 Maintenance Windows, 1 SSL Certificate"
echo ""
echo -e "Sites Extension Test Data:"
echo -e "  - 3 Sites (Next.js, SvelteKit, Static)"
echo -e "  - 5 Deployments (live, building, failed, rolled back)"
echo -e "  - 2 GitHub Connections"
echo -e "  - 2 S3 Providers"
echo -e "  - 7 days of Analytics Data"
echo ""
echo -e "${GREEN}All services running in Docker. Press Ctrl+C to stop.${NC}"
echo ""

# Keep script running
trap 'docker compose -f docker/docker-compose.visual-test.yml down' EXIT
tail -f /dev/null
