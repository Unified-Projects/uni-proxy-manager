#!/bin/bash
# ===========================================
# Uni-Proxy-Manager - Initialization Script
# ===========================================
# Run this script before first deployment to:
# - Validate configuration
# - Create necessary directories
# - Set up initial HAProxy configuration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "Uni-Proxy-Manager Initialization"
echo "========================================"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "ERROR: .env file not found!"
    echo "Please copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# Source .env file
set -a
source .env
set +a

# Validate required variables
if [ -z "$POSTGRES_PASSWORD" ] || [ "$POSTGRES_PASSWORD" = "CHANGE_THIS_TO_A_SECURE_PASSWORD" ]; then
    echo "ERROR: POSTGRES_PASSWORD is not set or is still the default value!"
    echo "Please edit .env and set a secure password."
    exit 1
fi

echo "Configuration validated."

# Create data directories (these will be used by Docker volumes on first run)
echo "Creating data directories..."
mkdir -p ./data/haproxy
mkdir -p ./data/certificates
mkdir -p ./data/error-pages
mkdir -p ./data/postgres
mkdir -p ./data/redis

# Create initial HAProxy configuration if it doesn't exist
if [ ! -f "./data/haproxy/haproxy.cfg" ]; then
    echo "Creating initial HAProxy configuration..."
    cat > ./data/haproxy/haproxy.cfg << 'HAPROXY_EOF'
# HAProxy Configuration
# This file is managed by Uni-Proxy-Manager API
# Manual changes may be overwritten

global
    log stdout format raw local0
    maxconn 4096
    stats socket /var/run/haproxy/haproxy.sock mode 660 level admin expose-fd listeners
    stats timeout 30s
    tune.ssl.default-dh-param 2048

defaults
    log global
    mode http
    option httplog
    option dontlognull
    option http-server-close
    option forwardfor except 127.0.0.0/8
    option redispatch
    retries 3
    timeout connect 5s
    timeout client 30s
    timeout server 30s
    timeout http-request 10s
    timeout http-keep-alive 10s
    timeout queue 30s
    timeout tunnel 1h

# Stats frontend
frontend stats
    bind *:8404
    mode http
    stats enable
    stats uri /stats
    stats refresh 10s
    stats admin if LOCALHOST

# HTTP frontend
frontend http_front
    bind *:80
    mode http

    # ACME challenge path for Let's Encrypt
    acl is_acme path_beg /.well-known/acme-challenge/

    # Redirect all HTTP to HTTPS (except ACME challenges)
    http-request redirect scheme https code 301 unless is_acme

    default_backend acme_backend

# HTTPS frontend - will be configured once certificates are available
# frontend https_front
#     bind *:443 ssl crt /data/certificates/ alpn h2,http/1.1
#     mode http
#     default_backend default_backend

# Default backend (returns 503)
backend default_backend
    mode http
    http-request deny deny_status 503

# ACME backend placeholder
backend acme_backend
    mode http
    http-request deny deny_status 503

HAPROXY_EOF
fi

echo ""
echo "========================================"
echo "Initialization Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Review your .env configuration"
echo "  2. Pull the Docker images:"
echo "     docker compose pull"
echo "  3. Start the services:"
echo "     docker compose up -d"
echo "  4. Access the dashboard at:"
echo "     http://localhost:${DASHBOARD_PORT:-3000}"
echo ""
echo "HAProxy stats available at:"
echo "  http://localhost:${HAPROXY_STATS_PORT:-8404}/stats"
echo ""
