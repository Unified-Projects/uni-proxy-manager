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
COPY apps/analytics/package.json ./apps/analytics/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/database ./packages/database
COPY packages/shared ./packages/shared
COPY packages/queue ./packages/queue
COPY apps/analytics ./apps/analytics
COPY tsconfig.json ./

# Build the analytics package (compiles TS and minifies client scripts)
RUN pnpm turbo run build --filter=@uni-proxy-manager/analytics...

# Create a pruned production bundle and include built output
RUN pnpm --filter=@uni-proxy-manager/analytics --prod deploy /prod/analytics && \
    cp -r /app/apps/analytics/dist /prod/analytics/dist

FROM oven/bun:1.3-alpine

WORKDIR /app

RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

COPY --from=builder --chown=appuser:appuser /prod/analytics ./

USER appuser

EXPOSE 3003

CMD ["bun", "run", "dist/index.js"]
