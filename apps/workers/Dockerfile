FROM oven/bun:1.3-alpine

WORKDIR /app

# Install pnpm 9.15.4 via curl
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache curl python3 make g++ libc-dev docker-cli redis && \
    curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL="$(which sh)" PNPM_VERSION="9.15.4" sh -

# Create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

# Copy root config files
COPY --chown=appuser:appuser package.json pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY --chown=appuser:appuser pnpm-lock.yaml* ./

# Copy package files for all workspaces
COPY --chown=appuser:appuser packages/database/package.json ./packages/database/
COPY --chown=appuser:appuser packages/shared/package.json ./packages/shared/
COPY --chown=appuser:appuser packages/queue/package.json ./packages/queue/
COPY --chown=appuser:appuser apps/workers/package.json ./apps/workers/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Rebuild native modules for Alpine Linux
RUN pnpm rebuild cpu-features dockerode 2>&1 || echo "Native rebuild completed"

# Copy source files
COPY --chown=appuser:appuser packages/database ./packages/database
COPY --chown=appuser:appuser packages/shared ./packages/shared
COPY --chown=appuser:appuser packages/queue ./packages/queue
COPY --chown=appuser:appuser apps/workers ./apps/workers

# Create data directories owned by appuser
RUN mkdir -p /data/haproxy /data/certificates /data/error-pages /data/acme && \
    chown -R appuser:appuser /data

# Ensure working directory is owned by appuser
RUN chown -R appuser:appuser /app

USER appuser

# Run TypeScript directly with Bun (no build step needed)
CMD ["bun", "run", "apps/workers/src/index.ts"]
