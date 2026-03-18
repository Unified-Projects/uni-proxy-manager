FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Install curl, nodejs (for pnpm), socat (for HAProxy stats socket), and Chromium for Playwright
RUN apk add --no-cache \
    curl \
    nodejs \
    npm \
    socat \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji

# Set Playwright to use system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install pnpm
RUN npm install -g pnpm

# Create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

# Copy root config files
COPY --chown=appuser:appuser package.json pnpm-workspace.yaml ./
COPY --chown=appuser:appuser pnpm-lock.yaml* ./

# Copy package files for all workspaces
COPY --chown=appuser:appuser packages/database/package.json ./packages/database/
COPY --chown=appuser:appuser packages/shared/package.json ./packages/shared/
COPY --chown=appuser:appuser packages/queue/package.json ./packages/queue/
COPY --chown=appuser:appuser apps/api/package.json ./apps/api/

# Install dependencies with pnpm
RUN pnpm install --frozen-lockfile

# Copy source files (needed before deploy so pnpm copies them into the bundle)
COPY --chown=appuser:appuser packages/database ./packages/database
COPY --chown=appuser:appuser packages/shared ./packages/shared
COPY --chown=appuser:appuser packages/queue ./packages/queue
COPY --chown=appuser:appuser apps/api ./apps/api
COPY --chown=appuser:appuser tsconfig.json ./

# Create a pruned production bundle of the api package
RUN pnpm --filter=@uni-proxy-manager/api --prod deploy /prod/api

FROM oven/bun:1.3-alpine

WORKDIR /app

RUN apk add --no-cache curl

RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

# Copy pruned production bundle from build stage
COPY --from=builder --chown=appuser:appuser /prod/api ./

# Create data directories owned by appuser
RUN mkdir -p /data/haproxy /data/certificates /data/error-pages && \
    chown -R appuser:appuser /data

USER appuser

EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
