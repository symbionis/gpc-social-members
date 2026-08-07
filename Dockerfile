FROM node:22-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips lifecycle scripts that fetch CLI binaries over the
# network (@posthog/cli, supabase) which (a) aren't used during `next build`
# and (b) intermittently 504 from GitHub releases and fail the whole build.
# Native deps (sharp, unrs-resolver) ship prebuilt binaries as optional
# dependency packages, so they still work without their verify scripts.
# The @posthog/cli binary this skips is fetched in the builder stage below,
# but only when sourcemap upload is switched on — see POSTHOG_SOURCEMAPS there.
RUN npm ci --ignore-scripts

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_ vars must be available at build time for client-side bundling.
# Railway passes service variables as Docker build args automatically.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_URL

# Source-map upload to PostHog. These must be declared here even though Railway
# already has them set: Docker only exposes build args the stage declares, so an
# undeclared variable reads as undefined inside `next build` and next.config.ts
# silently skips the upload. That is why production shipped minified until now.
ARG POSTHOG_SOURCEMAPS
ARG POSTHOG_PERSONAL_API_KEY
ARG POSTHOG_ENV_ID
ARG NEXT_PUBLIC_POSTHOG_HOST
# Railway injects the deploy's commit; .dockerignore excludes .git, so this is
# the only way the upload can tag a symbol set with a version.
ARG RAILWAY_GIT_COMMIT_SHA

# The deps stage installed with --ignore-scripts, so posthog-cli has no binary
# yet. Its wrapper downloads lazily on first invocation, so this is not strictly
# required — it pre-fetches into its own cacheable layer so a 504 from GitHub
# releases fails here, attributably, rather than surfacing halfway through
# `next build`. Gated so a flaky CDN cannot break a deploy that never asked for
# sourcemaps. Alpine is supported: the installer detects musl and pulls the
# unknown-linux-musl-dynamic target.
RUN if [ "$POSTHOG_SOURCEMAPS" = "1" ]; then npm rebuild @posthog/cli; fi

RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
