FROM node:24-bookworm

WORKDIR /app

# System dependencies:
#   curl    — used by the entrypoint health-wait loop
#   sudo    — execCmd() calls sudo for nginx/systemctl (stubs in local dev)
#   tmux    — terminal session management
#   bsdutils — provides the `script` command used to attach to tmux
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    iproute2 \
    sudo \
    tmux \
    bsdutils \
  && rm -rf /var/lib/apt/lists/*

# aadm expects this home directory for tmux config and sessions
RUN mkdir -p /var/lib/aadm

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Install root + workspace dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the web frontend
COPY web/ ./web/
RUN pnpm run build:web

# Build the server
COPY . .
RUN pnpm run build

HEALTHCHECK --interval=2s --timeout=5s --retries=15 \
  CMD curl -sf "http://localhost:${AADM_PORT:-8899}/health" || exit 1

CMD ["node", "dist/index.js"]
