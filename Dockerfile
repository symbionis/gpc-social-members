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
# NOTE: if sourcemap upload to PostHog is ever enabled in this image (by
# passing POSTHOG_PERSONAL_API_KEY + POSTHOG_ENV_ID as build args), the
# @posthog/cli binary will need to be present — drop --ignore-scripts then.
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
