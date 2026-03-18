FROM oven/bun:1.3-alpine

WORKDIR /app

# Install pnpm 9.15.4 via curl
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache curl && \
    curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.shrc" SHELL="$(which sh)" PNPM_VERSION="9.15.4" sh -

# Copy root config files
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY pnpm-lock.yaml* ./

# Copy database package
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/database ./packages/database
COPY packages/shared ./packages/shared
COPY tsconfig.json ./

# Build database package
RUN pnpm turbo run build --filter=@uni-proxy-manager/database

WORKDIR /app/packages/database

# Run migrations (--force skips interactive prompts in non-TTY environments)
CMD ["pnpm", "exec", "drizzle-kit", "push", "--force"]
