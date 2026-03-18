#!/bin/bash
# ===========================================
# Uni-Proxy-Manager - Backup Script
# ===========================================
# Creates backups of the database and certificates
#
# Usage:
#   ./backup.sh              - Create a full backup
#   ./backup.sh --db-only    - Backup database only
#   ./backup.sh --certs-only - Backup certificates only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Source .env file
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
POSTGRES_USER="${POSTGRES_USER:-uni_proxy_manager}"
POSTGRES_DB="${POSTGRES_DB:-uni_proxy_manager}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

backup_database() {
    echo "Backing up PostgreSQL database..."

    docker compose exec -T postgres pg_dump \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        --format=custom \
        --compress=9 \
        > "$BACKUP_DIR/database_${TIMESTAMP}.dump"

    echo "Database backup created: $BACKUP_DIR/database_${TIMESTAMP}.dump"
}

backup_certificates() {
    echo "Backing up certificates..."

    if [ -d "./data/certificates" ]; then
        tar -czf "$BACKUP_DIR/certificates_${TIMESTAMP}.tar.gz" -C ./data certificates
        echo "Certificates backup created: $BACKUP_DIR/certificates_${TIMESTAMP}.tar.gz"
    else
        echo "No certificates directory found, skipping..."
    fi
}

backup_config() {
    echo "Backing up HAProxy configuration..."

    if [ -d "./data/haproxy" ]; then
        tar -czf "$BACKUP_DIR/haproxy_config_${TIMESTAMP}.tar.gz" -C ./data haproxy
        echo "HAProxy config backup created: $BACKUP_DIR/haproxy_config_${TIMESTAMP}.tar.gz"
    else
        echo "No HAProxy config directory found, skipping..."
    fi
}

backup_error_pages() {
    echo "Backing up error pages..."

    if [ -d "./data/error-pages" ]; then
        tar -czf "$BACKUP_DIR/error_pages_${TIMESTAMP}.tar.gz" -C ./data error-pages
        echo "Error pages backup created: $BACKUP_DIR/error_pages_${TIMESTAMP}.tar.gz"
    else
        echo "No error pages directory found, skipping..."
    fi
}

cleanup_old_backups() {
    echo "Cleaning up backups older than 30 days..."
    find "$BACKUP_DIR" -type f -mtime +30 -delete
}

case "${1:-full}" in
    --db-only)
        backup_database
        ;;
    --certs-only)
        backup_certificates
        ;;
    --config-only)
        backup_config
        ;;
    full|*)
        echo "========================================"
        echo "Uni-Proxy-Manager Full Backup"
        echo "========================================"
        echo "Timestamp: $TIMESTAMP"
        echo ""

        backup_database
        backup_certificates
        backup_config
        backup_error_pages
        cleanup_old_backups

        echo ""
        echo "========================================"
        echo "Backup Complete!"
        echo "========================================"
        echo "Backup location: $BACKUP_DIR"
        ls -lh "$BACKUP_DIR"/*_${TIMESTAMP}* 2>/dev/null || true
        ;;
esac
