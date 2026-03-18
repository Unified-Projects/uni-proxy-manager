#!/bin/bash

# Integration Test Runner
# Runs all integration tests with proper setup and teardown

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}[Test Runner] Starting integration test suite...${NC}"

# Function to cleanup on exit
cleanup() {
    echo -e "${YELLOW}[Test Runner] Cleaning up...${NC}"
    cd "$PROJECT_ROOT"
    pnpm test:docker:down 2>/dev/null || true
}

# Register cleanup on script exit
trap cleanup EXIT

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}[Test Runner] Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

cd "$PROJECT_ROOT"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[Test Runner] Installing dependencies...${NC}"
    pnpm install
fi

# Stop any existing test containers
echo -e "${YELLOW}[Test Runner] Stopping any existing test containers...${NC}"
pnpm test:docker:down 2>/dev/null || true

# Start test containers
echo -e "${YELLOW}[Test Runner] Starting test containers...${NC}"
pnpm test:docker:up

# Wait for containers to be healthy
echo -e "${YELLOW}[Test Runner] Waiting for containers to be healthy...${NC}"
sleep 5

# Run the tests
echo -e "${GREEN}[Test Runner] Running integration tests...${NC}"
if pnpm test:integration; then
    echo -e "${GREEN}[Test Runner] All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}[Test Runner] Some tests failed.${NC}"
    exit 1
fi
