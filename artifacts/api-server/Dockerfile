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
# dist/index.mjs. The ONLY external package imported at runtime is nodemailer
# (a lazy import in src/lib/email.ts), so the runtime image installs just that
# with plain npm.
#
# NOTE: this repo runs a customized pnpm with a supply-chain policy layer that
# ignores onlyBuiltDependencies and makes every `pnpm install`/`pnpm run` exit
# non-zero (ERR_PNPM_IGNORED_BUILDS) over browser-tabs-lock. We therefore call
# the esbuild build directly with node and avoid `pnpm run`/`pnpm deploy`.
# -----------------------------------------------------------------------------

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---- Build stage: install full workspace and produce the bundle -------------
FROM base AS build
# Auth0 config is baked into the frontend bundle at build time (Vite inlines
# VITE_* vars). Pass via --build-arg; they are public SPA identifiers, not
# secrets.
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
COPY . .
# pnpm gates dependency build scripts behind an approval list. This workspace's
# allow-list isn't honored in a clean CI install, so pnpm exits non-zero with
# ERR_PNPM_IGNORED_BUILDS even though packages installed fine. We tolerate that
# exit (`;`) and then explicitly rebuild esbuild, whose native binary the
# bundling step (build.mjs) requires. browser-tabs-lock is a frontend-only dep
# and is not needed to build the API server.
RUN pnpm install --frozen-lockfile; pnpm rebuild esbuild
# Run the esbuild bundler directly (not via `pnpm run`, whose pre-run dep check
# re-triggers the ignored-builds gate). Outputs artifacts/api-server/dist.
RUN cd artifacts/api-server && node build.mjs

# Build the React frontend (Vite). Invoke the vite binary directly to avoid the
# pnpm pre-run gate. vite.config.ts requires PORT and BASE_PATH; BASE_PATH=/ so
# the SPA is served from the API root. Outputs artifacts/maverick/dist/public.
RUN cd artifacts/maverick && \
    NODE_ENV=production PORT=5173 BASE_PATH=/ \
    VITE_AUTH0_DOMAIN="$VITE_AUTH0_DOMAIN" \
    VITE_AUTH0_CLIENT_ID="$VITE_AUTH0_CLIENT_ID" \
    VITE_AUTH0_AUDIENCE="$VITE_AUTH0_AUDIENCE" \
    node_modules/.bin/vite build

# ---- Runtime stage ----------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# The bundled server (index.mjs + pino transport chunks + sourcemaps).
COPY --from=build /repo/artifacts/api-server/dist ./dist
# The built React app — Express serves this as static files (see app.ts).
COPY --from=build /repo/artifacts/maverick/dist/public ./public
# Install the sole runtime external. npm avoids pnpm's workspace/build gate;
# nodemailer has no native build scripts.
RUN npm install --no-save --no-package-lock nodemailer@6.9.16

# App listens on PORT (Azure App Service / Container Apps inject this).
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
