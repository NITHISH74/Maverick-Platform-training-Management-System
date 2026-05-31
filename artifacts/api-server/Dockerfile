# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# Node API server (artifacts/api-server)
#
# IMPORTANT: build with the repository ROOT as the build context, because this
# is a pnpm workspace and the build needs lib/* packages:
#
#   docker build -f artifacts/api-server/Dockerfile -t maverick-api .
#
# The esbuild build (build.mjs) bundles the app and workspace libs into
# dist/index.mjs but leaves a few packages external (nodemailer, drizzle-orm's
# native bits, etc.), so the runtime image ships a pruned production
# node_modules produced by `pnpm deploy`.
# -----------------------------------------------------------------------------

FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---- Build stage: install full workspace and produce the bundle -------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build
# Produce a self-contained folder with production node_modules for the API.
RUN pnpm --filter @workspace/api-server deploy --prod /app

# ---- Runtime stage ----------------------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production deps (nodemailer + other externalized packages live here).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# The bundled server (index.mjs + pino transport chunks + sourcemaps).
COPY --from=build /repo/artifacts/api-server/dist ./dist

# App listens on PORT (Azure App Service / Container Apps inject this).
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
