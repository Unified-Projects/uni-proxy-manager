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
COPY apps/pomerium-workers/package.json ./apps/pomerium-workers/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/database ./packages/database
COPY packages/shared ./packages/shared
COPY packages/queue ./packages/queue
COPY apps/pomerium-workers ./apps/pomerium-workers
COPY tsconfig.json ./

# Build packages
RUN pnpm turbo run build --filter=@uni-proxy-manager/pomerium-workers

FROM oven/bun:1.3-alpine

WORKDIR /app

RUN apk add --no-cache curl

# Copy built application
COPY --from=builder /app/apps/pomerium-workers/dist ./dist
COPY --from=builder /app/apps/pomerium-workers/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create config directory
RUN mkdir -p /config

CMD ["bun", "run", "dist/index.js"]
