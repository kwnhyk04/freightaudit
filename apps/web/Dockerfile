# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# The web app and the workspace packages it needs, with the lockfile cut down to them.
FROM base AS prune
COPY . .
RUN npx --yes turbo@2.11.7 prune @freightaudit/web --docker

FROM base AS build
RUN corepack enable pnpm
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /app/out/full/ .
RUN pnpm turbo run build --filter=@freightaudit/web...

# Next's standalone output: server.js and only the files the build traced to it.
FROM base
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/apps/web/.next/standalone .
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
