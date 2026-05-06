---
name: gpc-social-club
description: Read events, broadcasts, audience counts, and reference data from the Geneva Polo Social Club app, and prepare draft events or draft broadcasts for human review. Use when the user asks "what's coming up at the club", "how many active members", "draft a broadcast about X", or "create a draft event". Never sends mail, never publishes events, never returns member emails or names.
homepage: https://github.com/symbionis/gpc-social-members/blob/main/docs/agent-api.md
metadata: {"openclaw":{"emoji":"🏇","requires":{"env":["AGENT_API_TOKEN","GPC_API_BASE"]}}}
---

# GPC Social Club skill

Token-protected access to the Geneva Polo Social Club app. Six HTTPS endpoints under `/api/agent/*`. Reads + draft writes only — sends and publishes stay human-gated.

## When to use

Trigger phrases include:

- "What events are coming up", "any tournaments next month", "what's on the calendar in June"
- "How many active members", "what's the audience size for X", "how big is the Player tier"
- "What broadcasts have we sent", "did we send a May newsletter", "show recent broadcasts"
- "Draft an asado event for the 15th", "create a draft event titled X"
- "Draft a broadcast about Y", "prepare a message to active members about Z"

Don't trigger when:

- The user wants to send a broadcast or publish an event. This skill cannot do that — direct them to the admin UI at `/admin/messages` (broadcasts) or `/admin/events` (events).
- The user wants to look up a specific member, change member data, or see payment history. This skill exposes none of that.

## Authentication

Every request carries a fixed bearer token in the `Authorization` header:

```
Authorization: Bearer $AGENT_API_TOKEN
```

The token lives in the agent's environment as `AGENT_API_TOKEN`. If a request returns `503 { "error": "Agent API not configured" }`, the server doesn't have the token set — surface that to the operator; don't retry. If it returns `401 { "error": "Unauthorized" }`, the token is missing or wrong — also operator-visible; don't retry.

Base URL is the deployed app, e.g. `https://app.genevapolo.com` (or `http://localhost:3000` in dev). Treat the base URL as configuration: read from `GPC_API_BASE` or equivalent.

## Conventions

- Every body is JSON. Every successful response is a flat JSON object (no `data:` envelope).
- Status codes: `200` (read OK), `201` (draft created), `400` (validation), `401` (auth), `503` (server config), `500` (unexpected).
- Errors always look like `{ "error": "<reason>" }`.
- Dates are ISO `YYYY-MM-DD`. Times are `HH:MM` or `HH:MM:SS` (24-hour).
- Pagination on list endpoints: `?limit=<n>` (default 50, max 200) and `?offset=<n>`.
- IDs are UUIDs.

## Capabilities

### 1. List upcoming events — `GET /api/agent/events`

Use to answer factual questions about what's on the calendar.

Query params: `status` (`published` default | `draft` | `all`), `event_type_id`, `from` (default today), `to`, `limit`, `offset`.

```bash
curl -s "$BASE/api/agent/events?from=2026-06-01&to=2026-06-30" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

Returns `{ events: AgentEventListItem[], limit, offset }`. Each event includes `title`, `start_date`, `end_date`, `start_time`, `location`, `description`, `event_type_id`, `season_id`, `is_published`, `is_confirmed`, `registration_enabled`, prices, image URLs.

Resolve `event_type_id` and `season_id` to names via the `lookups` endpoint.

### 2. List broadcasts — `GET /api/agent/broadcasts`

Use to answer "what have we sent recently" or "are there drafts pending".

Query params: `status` (`all` default | `sent` | `draft` | `sending` | `failed`), `limit`, `offset`.

```bash
curl -s "$BASE/api/agent/broadcasts?status=sent&limit=10" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

Returns `{ broadcasts: AgentBroadcastListItem[], limit, offset }`. **Body HTML is intentionally NOT included** — this endpoint is for metadata and counts. If the user wants the body of a specific past broadcast, escalate to the admin UI; the agent surface doesn't expose it.

Each broadcast includes `subject`, `status`, `audience_filter`, `recipient_count`, `error_count`, `skipped_count`, `created_at`, `sent_at`, `channel`.

### 3. Reference lookups — `GET /api/agent/lookups`

Use **before** drafting any event or broadcast that references a tier or event type. Cache the result for the session — these change rarely.

```bash
curl -s "$BASE/api/agent/lookups" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

Returns `{ tiers, event_types, current_season }`.

- `tiers[]` — `id`, `name`, `slug`, `category` (`individual` | `corporate`), `price_eur`, `is_active`, `sort_order`.
- `event_types[]` — `id`, `name`, `slug`, `color`, `sort_order`.
- `current_season` — single object or `null` (the season currently flagged active).

### 4. Audience preview — `POST /api/agent/audience/preview`

Use to answer "how many members will receive this" before drafting a broadcast. **Counts only — never returns recipient emails or names.**

```bash
curl -sX POST "$BASE/api/agent/audience/preview" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "active", "tier_ids": ["<uuid>"] }'
```

Body: `{ status: "active" | "expired" | "all", tier_ids?: string[] }`. Empty / omitted `tier_ids` = any tier.

Returns `{ recipient_count, skipped_count, per_tier: [{ tier_name, count }, ...] }`.

`skipped_count` is members in scope by status/tier who are excluded by `marketing_consent = false`. Mention this when the count differs noticeably from total membership in scope, so the user understands the gap.

### 5. Create a draft event — `POST /api/agent/events/draft`

Use when the user describes an event and asks to put it on the calendar. Always inserted with `is_published=false`, `is_confirmed=false`, `registration_enabled=false` — admin reviews and publishes from `/admin/events`.

```bash
curl -sX POST "$BASE/api/agent/events/draft" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Asado — June",
    "start_date": "2026-06-15",
    "start_time": "19:00",
    "location": "Field 2",
    "event_type_id": "<uuid-from-lookups>",
    "visibility": "public"
  }'
```

Required: `title`, `start_date` (`YYYY-MM-DD`), `event_type_id`. Optional: `end_date`, `start_time`, `location`, `description`, `images` (array of URLs), `season_id`, `visibility` (`public` default | `members_only`).

Returns `201 { event_id, edit_url: "/admin/events" }`. **Tell the user where to review it** — don't pretend the event is on the calendar; it's a draft.

### 6. Create a draft broadcast — `POST /api/agent/broadcasts/draft`

Use when the user describes a message they want to send and asks to draft it. Always inserted with `status='draft'`, `channel='email'` — admin reviews and sends from the Drafts pane in `/admin/messages`.

```bash
curl -sX POST "$BASE/api/agent/broadcasts/draft" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Update from the club",
    "body_html": "<p>Hi {{first_name}}, ...</p>",
    "audience_filter": { "status": "active" }
  }'
```

Body: `{ subject, body_html, audience_filter: { status, tier_ids? } }`.

Merge variables in `body_html` are substituted at send time (admin-triggered):

- `{{first_name}}` — recipient's first name
- `{{last_name}}` — recipient's last name
- `{{tier_name}}` — recipient's membership tier
- `{{email}}` — recipient's email address

Returns `201 { broadcast_id, edit_url: "/admin/messages?tab=drafts" }`. Tell the user where to review.

## Workflows

### "What's coming up at the club next month?"

1. `GET /api/agent/lookups` (cache for the session) — to map type IDs → names.
2. `GET /api/agent/events?from=<first-of-next-month>&to=<last>` — published only.
3. Group results by `event_type_id`, format each event as `<date> · <type> · <title> · <location>`. Mention `is_confirmed=false` events as "TBC".

### "Draft a broadcast to active Player-tier members about the upcoming tournament"

1. `GET /api/agent/lookups` — find the `Player` tier id.
2. `POST /api/agent/audience/preview` with `{ status: "active", tier_ids: ["<player-id>"] }` — verify the audience exists and report the count to the user before drafting.
3. Draft `subject` and `body_html`. Use the merge variables for personalization where natural.
4. `POST /api/agent/broadcasts/draft` with the audience filter from step 2.
5. Tell the user the broadcast was saved as a draft, give them the recipient count, and link to `/admin/messages?tab=drafts` for review/send.

### "Schedule an asado for June 15th, 7pm, Field 2"

1. `GET /api/agent/lookups` — find the event type id matching "Asado", "Social", or whichever fits. If no clear match, ask the user which type.
2. `POST /api/agent/events/draft` with the structured fields.
3. Tell the user it's a draft on the calendar, link to `/admin/events` for review/publish.

## Hard constraints

- **No sends.** This skill cannot transmit a broadcast. There is no endpoint for it. If the user explicitly asks to send, decline and direct to the admin UI.
- **No publishes.** This skill cannot flip `is_published=true` on an event. Same routing.
- **No member PII.** This skill never returns member emails, names, or phone numbers. Audience preview is counts only. If the user asks to look up a specific member or see who's on a tier, decline.
- **No payments.** This skill exposes nothing about Stripe, registrations, or financial state.
- **Drafts are not commitments.** Always tell the user where to review a draft. Don't say "I've added the event to the calendar" — say "I've drafted the event; admin can publish it from /admin/events".

## When errors happen

- `400 { error }` — validation. The error message names the offending field. Fix the input and retry; do not retry blindly.
- `401` — auth. Don't retry. Surface to operator.
- `503` — server config (token unset). Don't retry. Surface to operator.
- `500` — unexpected. Retry once with backoff; if it fails again, surface to operator with the message.
- Network timeout — retry once. Audience preview can be 1-2 seconds; events list is sub-second.

## Reference

- API contract: `docs/agent-api.md` in this repo (full request/response schemas).
- Source: `app/api/agent/*` (route handlers), `lib/agent/responses.ts` (TypeScript response types).
