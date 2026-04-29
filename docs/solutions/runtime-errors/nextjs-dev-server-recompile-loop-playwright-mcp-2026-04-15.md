---
title: Next.js dev server infinite recompile loop caused by Playwright MCP file writes
date: 2026-04-15
category: runtime-errors
module: development-environment
problem_type: runtime_error
component: tooling
symptoms:
  - "Next.js dev server recompiles every ~75ms nonstop without code changes"
  - "Client-side links show correct URL on hover but clicking does nothing"
  - "React hydration never completes — server-rendered HTML works but no interactivity"
root_cause: config_error
resolution_type: config_change
severity: high
tags:
  - nextjs
  - dev-server
  - playwright-mcp
  - webpack
  - file-watcher
  - hydration
  - recompile-loop
---

# Next.js dev server infinite recompile loop caused by Playwright MCP file writes

## Problem

The Next.js dev server entered an infinite recompile loop (~75ms per cycle), preventing React hydration from completing. All `<Link>` components rendered as static `<a>` tags — URLs appeared on hover and the cursor changed to a pointer, but clicking did nothing because the Next.js client-side router never initialized.

## Symptoms

- Dev server output showed continuous `✓ Compiled in 70ms (504 modules)` lines with no code changes
- Links throughout the app (navigation, event cards, dashboard) showed correct `href` on hover but produced no navigation on click
- Pages rendered server-side HTML correctly but had zero client-side interactivity
- No JavaScript errors in the browser console

## What Didn't Work

- Checking for nested `<a>` tags or invalid HTML structure — the markup was correct
- Investigating the middleware for navigation interception — middleware was not the cause
- Looking for hydration mismatches in component code — there were none

## Solution

The Playwright MCP browser automation tool writes screenshots, console logs, and snapshots into `.playwright-mcp/` in the project root. Webpack's file watcher detected these writes and triggered recompilation, which in turn caused more tool output, creating a feedback loop.

Add `watchOptions.ignored` to `next.config.ts` to exclude non-source directories:

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack: (config, { isServer }) => {
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
```

After applying the fix, clear the stale build cache and restart:

```bash
rm -rf .next
npx next dev
```

## Why This Works

Webpack's file watcher monitors the entire project directory by default, only ignoring `node_modules`. When an external tool (Playwright MCP, review cache, etc.) writes files into the project root during development, each write triggers a recompile. If the tool writes frequently — as Playwright MCP does when taking screenshots or logging console output — the recompile cycle never settles, and the client-side JavaScript bundle is perpetually stale. The browser receives HTML but the JS that attaches event handlers and initializes the router never loads successfully.

Excluding these tool directories from the watcher breaks the feedback loop.

## Prevention

- When adding any MCP server or dev tool that writes output to the project directory, add its output directory to `watchOptions.ignored` in `next.config.ts`
- Common directories to ignore: `.playwright-mcp/`, `.context/`, `.claude/`, any review/cache tool directories
- The telltale symptom is continuous recompilation in the terminal with no code changes — check for this before debugging link/navigation issues

## Related Issues

- Similar to the general class of "file watcher storms" in webpack-based dev servers
- Also affects Turbopack if its watcher isn't configured to ignore tool output directories
