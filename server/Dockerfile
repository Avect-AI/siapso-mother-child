# SPDX-License-Identifier: MIT
# Build from the repository root, after `pnpm build` has written the pack:
#   docker build -f server/Dockerfile -t siapso-server .
# Only the engine, the server and the built pack are copied.
FROM node:24-slim AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY engine/package.json engine/package.json
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile --prod --filter @siapso/server...

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    SIAPSO_PACK_FILE=/app/pack/pack.json \
    SIAPSO_API_KEYS_FILE=/run/secrets/keys.json
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY package.json ./
COPY engine/package.json engine/package.json
COPY engine/src engine/src
COPY server/package.json server/package.json
COPY server/bin server/bin
COPY server/src server/src
COPY app/public/pack/pack.json pack/pack.json
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/bin/siapso-server.js"]
