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
// Only wraps when both required envs are present so local builds (and
// preview deploys without the personal API key) still succeed without upload.
const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const envId = process.env.POSTHOG_ENV_ID;

const finalConfig: NextConfig =
  personalApiKey && envId
    ? withPostHogConfig(nextConfig, {
        personalApiKey,
        envId,
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
      })
    : nextConfig;

export default finalConfig;
