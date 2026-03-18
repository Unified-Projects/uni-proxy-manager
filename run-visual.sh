#!/bin/bash

# Visual Testing Environment Controller
# Start and stop the visual testing environment for manual testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

print_usage() {
    echo -e "${CYAN}${BOLD}Visual Testing Environment${NC}"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start              Start the visual testing environment"
    echo "  stop               Stop the visual testing environment"
    echo "  restart            Restart the visual testing environment"
    echo "  status             Check if the environment is running"
    echo "  logs               Show logs from Docker containers"
    echo ""
    echo "Options for 'stop':"
    echo "  --cleanup, -c      Also remove test data directories"
    echo ""
    echo "Examples:"
    echo "  $0 start           # Start the environment"
    echo "  $0 stop            # Stop the environment"
    echo "  $0 stop --cleanup  # Stop and clean up all data"
    echo "  $0 logs            # View container logs"
}

check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}[Error] Docker is not running. Please start Docker and try again.${NC}"
        exit 1
    fi
}

start_environment() {
    echo -e "${CYAN}${BOLD}========================================${NC}"
    echo -e "${CYAN}${BOLD}  Starting Visual Testing Environment  ${NC}"
    echo -e "${CYAN}${BOLD}========================================${NC}"
    echo ""

    check_docker
    cd "$PROJECT_ROOT"

    # Check if already running
    if lsof -i :3000 > /dev/null 2>&1 || lsof -i :3001 > /dev/null 2>&1; then
        echo -e "${YELLOW}Environment appears to be already running.${NC}"
        echo -e "Run ${CYAN}$0 stop${NC} first, or ${CYAN}$0 restart${NC} to restart."
        exit 1
    fi

    # Run the existing start script
    bash scripts/visual-test-start.sh
}

stop_environment() {
    CLEANUP=false

    # Parse stop-specific arguments
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

    echo -e "${CYAN}${BOLD}========================================${NC}"
    echo -e "${CYAN}${BOLD}  Stopping Visual Testing Environment  ${NC}"
    echo -e "${CYAN}${BOLD}========================================${NC}"
    echo ""

    cd "$PROJECT_ROOT"

    if [ "$CLEANUP" = true ]; then
        bash scripts/visual-test-stop.sh --cleanup
    else
        bash scripts/visual-test-stop.sh
    fi

    echo ""
    echo -e "${GREEN}Environment stopped.${NC}"
}

restart_environment() {
    echo -e "${YELLOW}Restarting environment...${NC}"
    stop_environment
    echo ""
    sleep 2
    start_environment
}

check_status() {
    echo -e "${CYAN}${BOLD}Environment Status${NC}"
    echo ""

    cd "$PROJECT_ROOT"

    # Check web server
    if lsof -i :3000 > /dev/null 2>&1; then
        echo -e "  Web Dashboard (3000):  ${GREEN}Running${NC}"
    else
        echo -e "  Web Dashboard (3000):  ${RED}Stopped${NC}"
    fi

    # Check API server
    if lsof -i :3001 > /dev/null 2>&1; then
        echo -e "  API Server (3001):     ${GREEN}Running${NC}"
    else
        echo -e "  API Server (3001):     ${RED}Stopped${NC}"
    fi

    # Check Docker containers
    echo ""
    echo -e "${CYAN}Docker Containers:${NC}"

    if docker ps --filter "name=uni-proxy-visual" --format "table {{.Names}}\t{{.Status}}" 2>/dev/null | grep -q "uni-proxy"; then
        docker ps --filter "name=uni-proxy-visual" --format "  {{.Names}}: {{.Status}}"
    else
        echo -e "  ${YELLOW}No visual test containers running${NC}"
    fi

    echo ""

    # Check if fully running
    if lsof -i :3000 > /dev/null 2>&1 && lsof -i :3001 > /dev/null 2>&1; then
        echo -e "${GREEN}Environment is fully running${NC}"
        echo ""
        echo -e "Access the dashboard at: ${CYAN}http://localhost:3000${NC}"
    else
        echo -e "${YELLOW}Environment is not fully running${NC}"
        echo -e "Run ${CYAN}$0 start${NC} to start the environment"
    fi
}

show_logs() {
    cd "$PROJECT_ROOT"
    docker compose -f docker/docker-compose.visual-test.yml logs -f
}

# Main command handler
case "${1:-}" in
    start)
        shift
        start_environment "$@"
        ;;
    stop)
        shift
        stop_environment "$@"
        ;;
    restart)
        shift
        restart_environment "$@"
        ;;
    status)
        check_status
        ;;
    logs)
        show_logs
        ;;
    --help|-h|help)
        print_usage
        ;;
    "")
        print_usage
        exit 1
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        print_usage
        exit 1
        ;;
esac
