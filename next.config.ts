import type { NextConfig } from "next";

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

export default nextConfig;
