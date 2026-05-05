# Agent API surface for events + broadcasts

**Date:** 2026-05-05
**Status:** Requirements (ready for `/ce-plan`)
**Scope tier:** Standard

## Problem

A self-hosted Openclaw agent needs programmatic access to the GPC Social Members app so it can answer questions about the calendar / membership state and prepare draft events and broadcasts for human review.

Today the agent has no way in. The only credentials available are the Supabase service-role key (god-mode for the entire database, including `auth.users` and Stripe-related tables) and the per-admin Supabase auth session (browser-only, OTP-bound). Neither is appropriate to hand to a server-side agent.

## Users / actors

- **Agent (Openclaw)** — runs server-side, holds a long-lived bearer token, calls a small set of HTTPS endpoints. No browser, no OTP, no per-end-user identity.
- **Super-admin / events admin** — reviews drafts created by the agent in the existing admin UI and decides whether to publish/send.

## Goals

- Give the agent **read access** to events, broadcasts, and audience previews so it can answer factual questions about the club.
- Give the agent **draft-write access** so it can stage proposed events and broadcasts for an admin to review.
- Keep the credential's blast radius **strictly smaller than a Supabase service-role key**: the agent can't read members' personal data beyond what's needed for audience preview counts, can't touch payments/auth tables, and can't send live mail or publish to the public site.
- Make every agent action auditable — at minimum via Next.js access logs; ideally with PostHog events tagged `agent_*`.
- Keep the surface shape stable enough that future agent capabilities are "one more endpoint", not a redesign.

## Non-goals

- Agent **sending** broadcasts or **publishing** events directly. Sending and publishing remain human-gated.
- A dedicated agent-only UI. Drafts are reviewed in the existing admin pages.
- Multi-tenant agent permissioning. One shared bearer token to start; per-agent tokens / role-scoping is a future concern.
- Member-level writes (creating, updating, deleting members) from the agent.
- MCP, OpenAPI, or any agent-protocol-specific framing. The surface is plain HTTPS + JSON; Openclaw can speak it directly, and any future host (Claude Code MCP, Custom GPT) can be wrapped on top.

## Approach

A small set of HTTPS endpoints under `app/api/agent/*` in this Next.js app, protected by a single `AGENT_API_TOKEN` bearer token. Endpoints wrap the existing Supabase admin client and the existing audience resolver — no new business logic, just a controlled surface.

This surface depends on a separate feature: **broadcast drafts must be persistable**. The current broadcasts table only stores rows at send time; "agent drafts a broadcast" is meaningless without somewhere to store the draft. That feature is scoped in `docs/brainstorms/2026-05-05-broadcast-drafts-prompt.md` and is a prerequisite for the broadcast endpoints in this surface.

### Endpoints (sketch — full shapes belong in the plan)

Read:
- `GET  /api/agent/events` — query upcoming/past published + draft events, filterable by `event_type_id`, `status` (`published` / `draft`), and date range.
- `GET  /api/agent/broadcasts` — list broadcasts by `status` (`sent`, `draft`, `failed`), with audience filter and per-broadcast counts.
- `GET  /api/agent/audience/preview` — given an `audience_filter` (status + tier_ids), return recipient count, skipped-by-consent count, and per-tier breakdown. No emails, no PII.
- `GET  /api/agent/lookups` — small reference data: tiers, event types, seasons. Lets the agent reason about valid filters without inventing IDs.

Write (drafts only):
- `POST /api/agent/events/draft` — create an event with `is_published=false`. Validates required fields and rejects any attempt to set `is_published=true` from this endpoint.
- `POST /api/agent/broadcasts/draft` — create a broadcast row with `status='draft'`. Subject + body_html + audience_filter. Rejects any attempt to set `status='sent'` from this endpoint.

### Auth

- One env var: `AGENT_API_TOKEN` (long random string, set on Railway).
- Middleware in `app/api/agent/*` checks `Authorization: Bearer <token>` and rejects 401 otherwise.
- No member auth, no admin session, no Supabase JWT. The agent is its own thing.

### Observability

- Each endpoint logs `[agent] <method> <path> <outcome>` server-side.
- PostHog event `agent_action` with `{ endpoint, status_code, latency_ms, draft_id? }` for the dashboard.
- Optional follow-up: an `agent_actions` table for a permanent audit log if Postmark-style verbose logging isn't enough. Not required for v1.

## Why this approach (vs the alternatives)

| Approach | Why we picked / didn't |
|---|---|
| **B — Thin Next.js API surface (chosen)** | Smallest credential surface (token, not service-role key). Validations and defaults live with the rest of the app. PostHog already wired. ~2-3 hours upfront, then each new capability is ~20 lines. |
| A — Direct Supabase service-role key on the agent | Truly the lowest install effort, but the service-role key reads `auth.users`, payments-adjacent tables, and bypasses RLS. A leaked key on a self-hosted agent is catastrophic. Same broadcast-drafts work needed either way. |
| C — MCP server | Most agent-native, but Openclaw is self-hosted and speaks any protocol. An extra deployable to host with no immediate payoff. Could be added later as a thin wrapper around the same B endpoints. |

## Success criteria

- Agent can answer "what events are coming up in the next 30 days?" and "what's the recipient count for active members on the Player tier?" via two GET calls.
- Agent can submit a draft broadcast that an admin sees in `/admin/messages` (Drafts pane) and can edit/send normally.
- Agent can submit a draft event that an admin sees in `/admin/events` (existing list, filtered to drafts) and can publish normally.
- Revoking `AGENT_API_TOKEN` immediately disables agent access without touching any other system credential.
- A leaked `AGENT_API_TOKEN` cannot read member emails, payment data, or any `auth.*` table.
- The agent's last 100 actions are visible in PostHog under the `agent_action` event.

## Dependencies / assumptions

- **Depends on broadcast drafts feature** (separate prompt) being implemented first, OR the broadcast endpoints being shipped in a follow-up PR after that feature lands. Event endpoints can ship independently — events already have `is_published=false` as a draft state.
- Assumes Openclaw can hold a long-lived bearer token in env / secrets and call HTTPS. (Confirmed by user.)
- Assumes the agent runs in a controlled environment — token leakage risk is low but not zero, hence "blast radius < service-role key" is a hard requirement.
- Assumes one shared token is enough for v1. If the user later runs multiple agents that need different scopes, this surface can grow per-token roles without changing endpoint shapes.

## Out of scope for this surface (deferred)

- Agent **sending** broadcasts (post-draft). Stays human-only until trust is established.
- Agent **publishing** events (`is_published=true`). Same reason.
- Per-member operations: lookup, update, profile changes.
- Stripe / payments visibility.
- File uploads (images for events/broadcasts) — drafts can reference existing image URLs but can't upload new ones.
- Webhooks back to the agent (e.g. "this broadcast you drafted was sent"). Agent polls if it cares.

## Phase 2.5 synthesis

**Stated by the user:**
- Agent is self-hosted Openclaw and can speak any protocol.
- Capability scope: read + draft (no sends/publishes).
- First use cases: Q&A, draft broadcasts, draft events — all three.
- "Easiest way" is the framing, with Supabase API floated as a candidate.

**Inferred (and reflected in this doc):**
- Agent runs server-side and can hold a long-lived secret, but the chosen credential should be smaller than the Supabase service-role key.
- Drafts created by the agent should land in the existing admin UI for human review; no new agent-only UI.
- "Easiest" is a real constraint but not absolute — a few hours of work is acceptable to gain credential isolation, audit trail, and reusability for future agents.
- Events shipping ahead of broadcasts is acceptable (broadcasts depend on draft persistence; events don't).

**Out of scope (this surface):**
- Direct sends / publishes from the agent.
- Agent-only UI.
- Per-agent permissions.
- Member-level writes.
- Payments / auth-table visibility.
