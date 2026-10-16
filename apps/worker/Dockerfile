# Build from the repository root: docker build -f apps/worker/Dockerfile .
FROM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TURBO_TELEMETRY_DISABLED=1
WORKDIR /app

# The worker and the workspace packages it needs, with the lockfile cut down to them.
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.7 prune @freightaudit/worker --docker

FROM base AS build
RUN corepack enable pnpm
# Every package of the pruned lockfile, fetched into a store inside this layer: a layer cache hit (CI's gha cache)
# brings the packages along, which a cache mount would not, and both installs below run offline from it.
COPY --from=prune /app/out/json/package.json /app/out/json/pnpm-lock.yaml /app/out/json/pnpm-workspace.yaml ./
RUN pnpm fetch --store-dir /pnpm/store
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile --offline --store-dir /pnpm/store
COPY --from=prune /app/out/full/ .
RUN pnpm turbo run build --filter=@freightaudit/worker...
# A clean production-only install for the runtime: over the full one, pnpm leaves dev packages in node_modules/.pnpm.
RUN rm -rf node_modules */*/node_modules .turbo */*/.turbo \
  && pnpm install --frozen-lockfile --prod --offline --store-dir /pnpm/store

FROM base
ENV NODE_ENV=production HOST=0.0.0.0 WORKER_PORT=4001
COPY --from=build /app .
USER node
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.WORKER_PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--import", "./apps/worker/dist/telemetry.js", "apps/worker/dist/main.js"]
