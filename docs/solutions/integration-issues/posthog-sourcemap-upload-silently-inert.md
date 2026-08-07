---
module: "observability"
date: "2026-08-07"
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "Every production exception in PostHog Error Tracking shows a minified identifier — `a.J`, `ga`, `Ba` — with no file, no line, and no stack frames"
  - "`error-tracking-symbol-sets-list` returns entries with `has_uploaded_file: false`, `failure_reason: {\"JavaScript\":{\"NoSourcemap\":...}}` and `release: null`"
  - "Every deploy is green; `next build` succeeds; nothing in CI or the Railway build log is red"
  - "`POSTHOG_PERSONAL_API_KEY` and `POSTHOG_ENV_ID` are both present in the Railway service variables"
root_cause: misconfiguration
resolution_type: config_fix
related_components:
  - "Dockerfile builder stage"
  - "next.config.ts withPostHogConfig gate"
  - "@posthog/nextjs-config"
tags:
  - "posthog"
  - "error-tracking"
  - "sourcemaps"
  - "docker"
  - "build-args"
  - "railway"
  - "silent-failure"
---

# PostHog source-map upload was wired, configured, and completely inert for three months

## Problem

Error Tracking was adopted on 2026-05-08 (#13) with `withPostHogConfig` in `next.config.ts` and `@posthog/nextjs-config` installed. Both required credentials were set on the Railway production service. Every deploy since was green.

Not one source map was ever uploaded. Every production exception for three months arrived minified and permanently undebuggable — including six unhandled exceptions a real member hit in 84 seconds while logging in on 2026-08-07, which can never now be resolved because the build that produced those chunk hashes is gone.

Three independent failures were stacked, each hidden behind the one in front of it, and **all three were silent**.

## Symptoms

The only observable was the absence of a side effect. Nothing failed, nothing warned, nothing was red.

```
$exception_values: ["undefined is not an object (evaluating 'a.J')"]
$exception_values: ["ga"]
$exception_values: ["Ba"]
```

```
error-tracking-symbol-sets-list → count: 2
  has_uploaded_file: false
  failure_reason:    {"JavaScript":{"NoSourcemap":"https://social.genevapolo.com/login"}}
  release:           null
```

## What Didn't Work

**Reading the config.** `next.config.ts` and the Dockerfile both look correct in isolation. The gate is right, the plugin call is right, the credentials exist. The defect only appears where the two files meet.

**Trusting the Railway variable list.** `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_ENV_ID` are both set on the service. That is necessary and not sufficient — see below.

**Trusting a green build.** This is the load-bearing mistake. The build was green through all three failures, including the third one, where the CLI ran, authenticated, and printed `ERROR` three times before `next build` carried on and deployed successfully.

**Copying the docs.** The published `withPostHogConfig` options are `releaseName` / `releaseVersion`. The installed `@posthog/nextjs-config@1.7.6` takes `project` / `version`. Copying the documented shape would have silently done nothing — a fourth silent failure narrowly avoided by reading `node_modules/@posthog/webpack-plugin/dist/config.d.ts` instead.

## Solution

Three fixes, in the order they were uncovered.

**1. Declare the build args in the builder stage.** Docker only exposes build args the stage itself declares. Railway passes service variables as build args, but an undeclared name reads as `undefined` inside `next build`, so the `personalApiKey && envId` gate evaluated false and the wrapper no-opped.

```dockerfile
ARG POSTHOG_SOURCEMAPS
ARG POSTHOG_PERSONAL_API_KEY
ARG POSTHOG_ENV_ID
```

**2. Fetch the `posthog-cli` binary.** The deps stage runs `npm ci --ignore-scripts`, which skips the postinstall that downloads it. Gated behind the opt-in flag so a flaky CDN cannot break a deploy that never asked for uploads.

**3. Use a real personal API key.** The stored value was not a personal API key. PostHog personal keys start with `phx_`; project tokens start with `phc_`, and the two are easy to swap. The CLI said so precisely, in a log nobody was reading:

```
ERROR posthog_cli::commands: "Oops! Invalid Personal API key:
      \"Token looks wrong, must start with 'phx_'\""
```

Result: 2 symbol sets → 237, `has_uploaded_file: true`, `release.version` carrying the exact deploy commit.

## Why This Works

`ARG` scope is per-stage, not per-Dockerfile. A multi-stage build gives each stage its own build-arg namespace; declaring a name in `deps` does nothing for `builder`. Nothing warns about an undeclared arg, because from Docker's perspective you simply did not ask for it.

Everything downstream then reads as normal behaviour: an undefined env var makes a defensive gate skip, and skipping is exactly what the gate was written to do when credentials are absent.

## Prevention

**Verify at the destination, not the source.** A build that succeeded proves nothing about a side effect that was supposed to happen inside it. The only check that meant anything here was querying PostHog for the artifact — `error-tracking-symbol-sets-list`, looking at `has_uploaded_file`. Whenever a build step's real output lands in another system, check that system.

**A defensive gate hides its own failure.** `if (creds) { upload() }` is the right shape — it lets local builds work — but it converts a misconfiguration into a silent skip. When a gate exists so absence is tolerated, absence stops being observable. Pair it with a destination check, or log loudly when the gate closes in production.

**Never name a secret on a `RUN` command line.** BuildKit substitutes ARG values into the command it logs: `RUN if [ "$POSTHOG_SOURCEMAPS" = "1" ]` appears in the Railway build log as `RUN if [ "1" = "1" ]`. A secret referenced the same way would be printed in plaintext. Secrets may be read from `process.env` by the build tool, never interpolated into a shell line.

**A secret ARG in a builder stage does not reach the deployed image.** `runner` is a separate `FROM` that never declares it, so it is absent from the final image's config and history. The residual exposure is the build cache. BuildKit's `SecretsUsedInArgOrEnv` warning is still worth respecting — the clean fix is `--mount=type=secret`, which needs the platform to pass a build secret rather than a build arg. Railway does not today.

**Read the installed types, not the docs.** Published option names drift ahead of or behind the version you have. `node_modules/<pkg>/dist/*.d.ts` is the contract that will actually run.

## Related

- `docs/solutions/runtime-errors/use-client-export-invoked-from-server-component.md` — the other 2026-08-07 defect where every local gate was green and production threw on every request. Same failure family: the check that would have caught it was not the check being run.
- PR #97 — the fix.
- `next.config.ts`, `Dockerfile` — the two files whose interaction is the defect.
