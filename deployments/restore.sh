#!/bin/bash
# ===========================================
# Uni-Proxy-Manager - Restore Script
# ===========================================
# Restores database and/or files from backup
#
# Usage:
#   ./restore.sh database backups/database_20240101_120000.dump
#   ./restore.sh certificates backups/certificates_20240101_120000.tar.gz
#   ./restore.sh config backups/haproxy_config_20240101_120000.tar.gz

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Source .env file
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

POSTGRES_USER="${POSTGRES_USER:-uni_proxy_manager}"
POSTGRES_DB="${POSTGRES_DB:-uni_proxy_manager}"

usage() {
    echo "Usage: $0 <type> <backup_file>"
    echo ""
    echo "Types:"
    echo "  database     - Restore PostgreSQL database from .dump file"
    echo "  certificates - Restore certificates from .tar.gz file"
    echo "  config       - Restore HAProxy config from .tar.gz file"
    echo "  error-pages  - Restore error pages from .tar.gz file"
    echo ""
    echo "Examples:"
    echo "  $0 database backups/database_20240101_120000.dump"
    echo "  $0 certificates backups/certificates_20240101_120000.tar.gz"
    exit 1
}

if [ $# -lt 2 ]; then
    usage
fi

TYPE="$1"
BACKUP_FILE="$2"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

case "$TYPE" in
    database)
        echo "========================================"
        echo "Restoring Database"
        echo "========================================"
        echo "Backup file: $BACKUP_FILE"
        echo ""
        echo "WARNING: This will overwrite the current database!"
        read -p "Are you sure you want to continue? (yes/no): " confirm

        if [ "$confirm" != "yes" ]; then
            echo "Restore cancelled."
            exit 0
        fi

        echo "Restoring database..."

        # Drop and recreate database
        docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS $POSTGRES_DB;"
        docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER;"

        # Restore from backup
        cat "$BACKUP_FILE" | docker compose exec -T postgres pg_restore \
            -U "$POSTGRES_USER" \
            -d "$POSTGRES_DB" \
            --no-owner \
            --no-privileges

        echo "Database restored successfully!"
        ;;

    certificates)
        echo "========================================"
        echo "Restoring Certificates"
        echo "========================================"
        echo "Backup file: $BACKUP_FILE"
        echo ""

        mkdir -p ./data
        tar -xzf "$BACKUP_FILE" -C ./data

        echo "Certificates restored to ./data/certificates"
        echo "Reloading HAProxy..."
        docker compose kill -s HUP haproxy || true
        echo "Done!"
        ;;

    config)
        echo "========================================"
        echo "Restoring HAProxy Configuration"
        echo "========================================"
        echo "Backup file: $BACKUP_FILE"
        echo ""

        mkdir -p ./data
        tar -xzf "$BACKUP_FILE" -C ./data

        echo "HAProxy config restored to ./data/haproxy"
        echo "Reloading HAProxy..."
        docker compose kill -s HUP haproxy || true
        echo "Done!"
        ;;

    error-pages)
        echo "========================================"
        echo "Restoring Error Pages"
        echo "========================================"
        echo "Backup file: $BACKUP_FILE"
        echo ""

        mkdir -p ./data
        tar -xzf "$BACKUP_FILE" -C ./data

        echo "Error pages restored to ./data/error-pages"
        ;;

    *)
        echo "ERROR: Unknown restore type: $TYPE"
        usage
        ;;
esac
