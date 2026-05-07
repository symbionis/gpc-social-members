# Agent API

Token-protected HTTPS surface under `/api/agent/*` for a self-hosted agent to read club state and submit draft events / broadcasts for human review. Sends and publishes are intentionally **not** exposed — admins keep both gates.

- Brainstorm: [docs/brainstorms/2026-05-05-agent-api-surface-requirements.md](brainstorms/2026-05-05-agent-api-surface-requirements.md)
- Plan: [docs/plans/2026-05-05-001-feat-agent-api-surface-plan.md](plans/2026-05-05-001-feat-agent-api-surface-plan.md)

## Authentication

Every request must carry the bearer token in the `Authorization` header:

```
Authorization: Bearer $AGENT_API_TOKEN
```

The token is a single static value stored in the `AGENT_API_TOKEN` server-only env var (no `NEXT_PUBLIC_` prefix). Generate it with:

```bash
openssl rand -base64 48
```

Set it on Railway and locally in `.env.local`. Rotate by replacing the value — no rebuild required, no other credentials touched.

## Conventions

- All request bodies and responses are JSON.
- Status codes:
  - `200` success (read), `201` created (draft writes)
  - `400` validation error — body has `{ "error": "<reason>" }`
  - `401` missing or wrong token
  - `503` `AGENT_API_TOKEN` is not configured on the server
  - `500` unexpected server error
- Pagination on read endpoints: `?limit=<n>` (default 50, max 200) and `?offset=<n>`.
- Dates are ISO `YYYY-MM-DD`. Times are 24-hour `HH:MM` or `HH:MM:SS`.
- Draft endpoints **always** force `is_published=false` (events) or `status='draft'` (broadcasts) regardless of input. The agent cannot bypass these gates.

## Endpoints

### `GET /api/agent/events`

List events the agent can reason about.

Query parameters:
- `status` — `published` (default), `draft`, `all`
- `event_type_id` — UUID; restrict to a single type
- `from` — `YYYY-MM-DD`; defaults to today
- `to` — `YYYY-MM-DD`; optional upper bound
- `limit`, `offset` — pagination

Example:

```bash
curl -s "$BASE/api/agent/events?status=published&from=2026-05-01&limit=20" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" | jq
```

Response:

```json
{
  "events": [
    {
      "id": "uuid",
      "title": "Solstice Cup",
      "start_date": "2026-06-21",
      "end_date": null,
      "start_time": null,
      "location": "Field 1",
      "description": "...",
      "image_url": null,
      "image_url_2": null,
      "images": ["https://..."],
      "visibility": "public",
      "is_published": true,
      "is_confirmed": true,
      "registration_enabled": true,
      "price_member": 0,
      "price_non_member": 80,
      "event_type_id": "uuid",
      "season_id": "uuid"
    }
  ],
  "limit": 20,
  "offset": 0
}
```

### `GET /api/agent/broadcasts`

List broadcasts (sent or draft). `body_html` is intentionally omitted from this endpoint — large and not useful for read-only Q&A.

Query parameters:
- `status` — `sent`, `draft`, `sending`, `failed`, `all` (default `all`)
- `limit`, `offset` — pagination

Example:

```bash
curl -s "$BASE/api/agent/broadcasts?status=sent&limit=10" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" | jq
```

Response:

```json
{
  "broadcasts": [
    {
      "id": "uuid",
      "subject": "May newsletter",
      "status": "sent",
      "audience_filter": { "status": "active", "tier_ids": [] },
      "recipient_count": 64,
      "error_count": 0,
      "skipped_count": 3,
      "created_at": "2026-05-01T10:00:00Z",
      "sent_at": "2026-05-01T10:01:12Z",
      "channel": "email"
    }
  ],
  "limit": 10,
  "offset": 0
}
```

### `GET /api/agent/lookups`

Reference data needed to construct valid filters and drafts. Cache aggressively on the agent side — these change rarely.

Example:

```bash
curl -s "$BASE/api/agent/lookups" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" | jq
```

Response:

```json
{
  "tiers": [
    { "id": "uuid", "name": "Player", "slug": "player", "category": "individual", "price_eur": 1200, "is_active": true, "sort_order": 1 }
  ],
  "event_types": [
    { "id": "uuid", "name": "Tournament", "slug": "tournament", "color": "#052938", "sort_order": 1 }
  ],
  "current_season": {
    "id": "uuid",
    "name": "2026 Season",
    "slug": "2026",
    "start_date": "2026-04-01",
    "end_date": "2026-09-30",
    "is_current": true
  }
}
```

`current_season` is `null` if no season covers today.

### `POST /api/agent/audience/preview`

Given an audience filter, return how many recipients a broadcast would reach. **Counts only — no emails or names.**

Request body:

```json
{
  "status": "active",
  "tier_ids": ["uuid", "uuid"]
}
```

- `status` — `active`, `expired`, or `all` (required)
- `tier_ids` — optional array; empty / omitted = any tier

Example:

```bash
curl -sX POST "$BASE/api/agent/audience/preview" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "active" }' | jq
```

Response:

```json
{
  "recipient_count": 64,
  "skipped_count": 3,
  "per_tier": [
    { "tier_name": "Player", "count": 32 },
    { "tier_name": "Social", "count": 28 },
    { "tier_name": null, "count": 4 }
  ]
}
```

`skipped_count` is the number of members in scope by status/tier who are excluded by `marketing_consent = false`.

### `POST /api/agent/events/draft`

Create a draft event. Always inserted with `is_published=false`, `is_confirmed=false`, `registration_enabled=false`. Admin reviews and publishes from `/admin/events`.

Required: `title`, `start_date` (`YYYY-MM-DD`), `event_type_id` (UUID — fetch from `/api/agent/lookups`).

Optional: `end_date`, `start_time` (`HH:MM[:SS]`), `location`, `description`, `images` (array of URLs), `season_id` (UUID), `visibility` (`public` default, or `members_only`).

Any `is_published` / `id` / `created_at` fields in the request body are ignored.

Example:

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
  }' | jq
```

Response:

```json
{
  "event_id": "uuid",
  "edit_url": "/admin/events"
}
```

### `PATCH /api/agent/events/{id}`

Partial update of an existing event. Send only the fields you want to change.

Editable fields: `title`, `event_type_id`, `season_id`, `start_date`, `end_date`, `start_time`, `location`, `description`, `notes`, `images`, `visibility`, `registration_enabled`, `price_member`, `price_non_member`.

Not editable by the agent: `is_published`, `is_confirmed`. Those gates stay with admins, mirroring the draft-create endpoint.

Validation:

- When `registration_enabled` is (or becomes) `true`, `price_member` is required.
- For public events with registration enabled, `price_non_member` is also required.
- For `members_only` events, `price_non_member` is forced to `null` regardless of input.
- `end_date` (if provided) must be on or after `start_date` after the merge.

Example — flip an event to members-only:

```bash
curl -sX PATCH "$BASE/api/agent/events/<event_id>" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "visibility": "members_only" }' | jq
```

Response:

```json
{
  "event_id": "uuid",
  "updated_fields": ["visibility", "price_non_member"]
}
```

Returns `404` if the event does not exist, `400` for validation failures.

### `POST /api/agent/broadcasts/draft`

Create a draft broadcast. Always inserted with `status='draft'`, `channel='email'`. Admin reviews and sends from the Drafts pane in `/admin/messages`.

Request body:

```json
{
  "subject": "Update from the club",
  "body_html": "<p>Hi {{first_name}}, ...</p>",
  "audience_filter": {
    "status": "active",
    "tier_ids": []
  }
}
```

- `subject` — string; may be empty for drafts
- `body_html` — HTML string; merge variables `{{first_name}}`, `{{last_name}}`, `{{tier_name}}` are substituted by the existing send pipeline at send time (admin-triggered)
- `audience_filter.status` — `active`, `expired`, or `all` (required)
- `audience_filter.tier_ids` — optional array; empty / omitted = any tier

Any `status` / `id` / `created_at` fields in the request body are ignored.

Example:

```bash
curl -sX POST "$BASE/api/agent/broadcasts/draft" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Spring update",
    "body_html": "<p>Hi {{first_name}}, ...</p>",
    "audience_filter": { "status": "active" }
  }' | jq
```

Response:

```json
{
  "broadcast_id": "uuid",
  "edit_url": "/admin/messages?tab=drafts"
}
```

## Observability

Every agent request emits a PostHog event named `agent_action` with the following properties:

- `endpoint` — e.g. `/api/agent/events`
- `method` — `GET` or `POST`
- `status_code` — HTTP response code
- `latency_ms` — total handler time
- `count` / `recipient_count` / `broadcast_id` / `event_id` — included where relevant

The `distinct_id` is `agent:openclaw`, so all agent activity rolls up to a single PostHog person profile. Filter for `agent_action` in PostHog → Insights to see usage trends and failure rates.

## Limits and notes

- **No PII**: `audience/preview` returns counts only; `broadcasts` omits `body_html`; nothing in this surface returns member email or name.
- **No sends, no publishes**: there is intentionally no path through this surface to push a broadcast or publish an event. The send pipeline lives at `/api/admin/broadcasts/send` and requires a super-admin browser session.
- **No file uploads**: drafts can reference existing image URLs but cannot upload new ones.
- **Single token**: per-agent tokens / scoped roles are not implemented in v1.

## Local dev

In `.env.local`:

```
AGENT_API_TOKEN=$(openssl rand -base64 48)
```

Then with `npm run dev`:

```bash
BASE=http://localhost:3000
AGENT_API_TOKEN=<the value you set>
curl -s "$BASE/api/agent/lookups" -H "Authorization: Bearer $AGENT_API_TOKEN" | jq
```
