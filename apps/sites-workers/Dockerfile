FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Install pnpm 9.15.4 via curl
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache curl && \
    curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL="$(which sh)" PNPM_VERSION="9.15.4" sh -

# Copy root config files
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY pnpm-lock.yaml* ./

# Copy package files for all workspaces
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY packages/queue/package.json ./packages/queue/
COPY apps/sites-workers/package.json ./apps/sites-workers/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/database ./packages/database
COPY packages/shared ./packages/shared
COPY packages/queue ./packages/queue
COPY apps/sites-workers ./apps/sites-workers
COPY tsconfig.json ./

# Build packages
RUN pnpm turbo run build --filter=@uni-proxy-manager/sites-workers

FROM oven/bun:1.3-alpine

WORKDIR /app

RUN apk add --no-cache git curl chromium nss freetype harfbuzz ca-certificates ttf-freefont nodejs npm

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy built application
COPY --from=builder /app/apps/sites-workers/dist ./dist
COPY --from=builder /app/apps/sites-workers/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create data directories
RUN mkdir -p /data/sites /data/haproxy /tmp/builds

CMD ["bun", "run", "dist/index.js"]
