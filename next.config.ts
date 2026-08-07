import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack: (config, { isServer }) => {
    // Prevent file-watcher loops caused by Playwright MCP and other tool dirs
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.next/**",
        "**/.playwright-mcp/**",
        "**/.context/**",
        "**/.git/**",
      ],
    };
    return config;
  },
};

// Source-map upload to PostHog for readable Error Tracking stack traces.
//
// Three things must line up or exceptions arrive minified (`a.J`, `ga`) with no
// file or line, which is what production looked like until 2026-08-07:
//   1. POSTHOG_SOURCEMAPS=1 — the opt-in below. It is also the kill switch:
//      unset it on Railway to ship without uploads if the posthog-cli download
//      is failing, instead of reverting this file.
//   2. Both credentials present AND declared as ARGs in the Dockerfile builder
//      stage. Docker only exposes build args it declares, so a variable that is
//      set on Railway but undeclared reads as undefined here and silently
//      disables uploads — no warning, green build, minified errors.
//   3. The posthog-cli binary on PATH. The deps stage installs with
//      --ignore-scripts, so the Dockerfile fetches it only when uploads are on.
const sourcemapsEnabled = process.env.POSTHOG_SOURCEMAPS === "1";
const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const envId = process.env.POSTHOG_ENV_ID;

const finalConfig: NextConfig =
  sourcemapsEnabled && personalApiKey && envId
    ? withPostHogConfig(nextConfig, {
        personalApiKey,
        envId,
        // Ingestion host, matching the plugin's own default (us.i.posthog.com).
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
        sourcemaps: {
          enabled: true,
          project: "gpc-social-members",
          // .dockerignore excludes .git, so the plugin cannot read the commit
          // itself. Railway injects it as a build arg instead; without it,
          // uploaded symbol sets carry release: null and are harder to trace
          // back to a deploy.
          version: process.env.RAILWAY_GIT_COMMIT_SHA,
        },
      })
    : nextConfig;

export default finalConfig;
