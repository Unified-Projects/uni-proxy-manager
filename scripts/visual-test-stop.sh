#!/bin/bash

# Visual Test Environment Stopper
# Stops all visual testing services and optionally cleans up data

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CLEANUP=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --cleanup|-c)
            CLEANUP=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

cd "$PROJECT_ROOT"

echo -e "${YELLOW}Stopping visual testing environment...${NC}"

# Kill any running processes on ports 3000 and 3001
echo -e "${YELLOW}Stopping any running dev servers...${NC}"
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
pkill -f "turbo dev" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true

# Stop containers
echo -e "${YELLOW}Stopping Docker containers...${NC}"
docker compose -f docker/docker-compose.visual-test.yml down -v 2>/dev/null || true

if [ "$CLEANUP" = true ]; then
    echo -e "${YELLOW}Cleaning up test data directories...${NC}"
    rm -rf docker/visual-test-data
fi

echo -e "${GREEN}Visual testing environment stopped.${NC}"

if [ "$CLEANUP" = true ]; then
    echo -e "${GREEN}Test data cleaned up.${NC}"
else
    echo -e "Run with ${YELLOW}--cleanup${NC} to also remove test data directories."
fi
