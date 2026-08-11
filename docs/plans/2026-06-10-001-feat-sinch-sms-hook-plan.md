---
title: "feat: Sinch SMS delivery via Supabase Send SMS Hook"
status: active
date: 2026-06-10
type: feat
origin: none (direct planning)
---

# feat: Sinch SMS delivery via Supabase Send SMS Hook

## Summary

Route Supabase Auth phone-OTP delivery through **Sinch** (not a native Supabase
provider) using the **Send SMS Hook**. Supabase generates the OTP and POSTs a
signed payload to a Supabase **Edge Function** (`sinch-sms`); the function verifies
the Standard Webhooks signature and relays the code via the Sinch SMS REST API.

This plan covers **only** the delivery pipeline (hook → Edge Function → Sinch) and
its configuration. It does **not** add phone login to the app UI or change the
member identity model — the existing email-OTP login (`app/actions/auth.ts`) is
untouched. Those are explicitly deferred (see Scope Boundaries).

---

## Problem Frame

The project owner created a Sinch account to send authentication SMS. Sinch is not
a built-in Supabase SMS provider, so Supabase cannot send through it directly. The
supported bridge is the Send SMS Hook: an HTTPS endpoint Supabase calls whenever it
needs to send an auth SMS, letting us transport the OTP through any provider.

An external recommendation outlined the right overall shape (hook + Edge Function +
secrets) but contained three defects that this plan corrects:

1. **Hardcoded `us` region.** Sinch endpoints are region-locked. A Switzerland-based
   account is almost certainly **EU** (`eu.sms.api.sinch.com`). Wrong region returns
   401/404 and is the single most common failure. Region becomes a configurable secret.
2. **No webhook signature verification.** The original left the Edge Function as a
   public, unauthenticated URL — anyone discovering it could burn Sinch credits or
   spam numbers. The Send SMS Hook signs every request (Standard Webhooks); the
   function **must** verify it.
3. **No mention of disabling JWT verification.** The hook calls the function with a
   Standard Webhooks signature, not a Supabase JWT. With the default gateway auth on,
   Supabase 401s the call before our code runs. **Note (review correction):** the MCP
   `deploy_edge_function` tool takes `verify_jwt` as an explicit parameter that defaults
   to `true` and does **not** read `config.toml` — so JWT must be disabled by passing
   `verify_jwt: false` to the deploy call itself, not via a config file (see U2).

Intended outcome: calling `supabase.auth.signInWithOtp({ phone })` results in an SMS
delivered by Sinch, verifiable end-to-end.

> **Open decision (set by review, owner to settle):** whether to *enable* the Phone
> provider + Send SMS Hook on production now, or deploy the function dormant and enable
> only when app-side phone login ships. See **Open Questions**. The plan below assumes
> the safer default — deploy the function, defer enabling the provider — and the
> Deployment section is split accordingly.

---

## Requirements

- **R1** — Supabase auth phone-OTP messages are delivered via the Sinch SMS REST API.
- **R2** — The Edge Function rejects any request whose Standard Webhooks signature does
  not verify against the hook secret (no Sinch call on failure).
- **R3** — The Sinch region/endpoint is configurable without code changes (secret),
  defaulting to EU.
- **R4** — On Sinch success the function returns HTTP 200 with an empty body; on Sinch
  failure it returns the upstream status and a diagnostic message so Supabase surfaces
  a meaningful error.
- **R5** — Secrets (Sinch creds, hook secret) are never committed; they live in Supabase
  Edge Function secrets.
- **R6** — The existing email-OTP login flow continues to work unchanged.
- **R7** — The function sends only to E.164 recipients: a `user.phone` that is not valid
  E.164 (after at most a single `00`→`+` / leading-`+` normalization) is rejected loudly
  rather than relayed, so no paid SMS is sent to a malformed number.
- **R8** — OTP values never appear in error responses or logs. Error payloads carry a
  fixed-template message (HTTP status only); log lines carry masked phone + Sinch status,
  never the OTP or the full verified payload.

---

## Key Technical Decisions

- **Edge Function as the hook target (HTTPS), not a Postgres function.** Matches the
  recommendation and keeps the Sinch call in TypeScript/Deno with `fetch`. The Postgres
  + `pg_cron` batching variant is unnecessary for OTP volume.
- **Standard Webhooks verification via `standardwebhooks@1.0.0` (esm.sh).** This is the
  library Supabase's own docs use. The hook secret is supplied as `v1,whsec_<base64>`;
  strip the `v1,whsec_` prefix and pass the base64 remainder to the `Webhook` constructor.
  The library enforces a **hardcoded 300s timestamp tolerance** (replay window), so a
  captured signed request can't be replayed after 5 minutes — no extra config needed.
  Guard against a missing/empty `SEND_SMS_HOOK_SECRET`
  (return 500) rather than constructing `Webhook("")`, whose empty-secret behavior is
  unspecified — this matters in the deploy-before-secret window.
- **Region as a secret (`SINCH_SMS_REGION`, default `eu`).** Endpoint built as
  `https://${region}.sms.api.sinch.com/xms/v1/${planId}/batches`. Lets us fix a wrong
  guess by changing a secret, not redeploying code.
- **JWT verification disabled via the deploy call, not a config file.** The MCP
  `deploy_edge_function` tool exposes `verify_jwt` (default `true`) and ignores
  `config.toml`; the deploy must pass `verify_jwt: false`. A `config.toml` is kept only as
  documentation for any future CLI deploy (see U2). Confirm JWT is off in the dashboard
  post-deploy. Required for the hook to reach the function.
- **Fail loud on non-E.164 recipients** — do **not** assume the hook payload carries a
  clean number. Every existing auth user was created via *email* OTP, so `auth.users.phone`
  is null today; a phone only exists once `signInWithOtp({ phone })` is called with a typed
  number, and `members.phone` holds inconsistent `00`/malformed values. Apply at most one
  normalization (`00…`→`+…`, or accept a leading `+`); if the result isn't valid E.164,
  reject (R7) instead of blindly prefixing `+` and sending a paid SMS to garbage.
- **Provider stub: enable Phone provider, avoid "Twilio Verify" — verify at config time.**
  Dummy creds are intended only to satisfy the dashboard's save validation, with the hook
  overriding actual sending; Twilio *Verify* specifically would make Supabase verify the
  OTP against Twilio and break the flow. This behavior is **inherited from the original
  recommendation and not yet verified against the current dashboard** — confirm at step 4
  that the dummy-cred save succeeds and the hook is the sole sender.

---

## Output Structure

```
supabase/
├── config.toml              # new — documents verify_jwt=false for CLI deploys (MCP ignores it)
└── functions/
    └── sinch-sms/
        └── index.ts         # new — hook handler: verify signature → send via Sinch
```

---

## Implementation Units

### U1. Edge Function `sinch-sms` (hook handler)

- **Goal:** Receive the signed Send SMS Hook payload, verify it, and relay the OTP to
  Sinch; return Supabase's success/failure contract.
- **Requirements:** R1, R2, R3, R4, R7, R8.
- **Dependencies:** none.
- **Files:**
  - `supabase/functions/sinch-sms/index.ts` (create)
  - `supabase/functions/sinch-sms/deno.json` (optional, only if pinning imports)
- **Approach:**
  1. Guard config: if `SEND_SMS_HOOK_SECRET` is absent/empty → return 500 immediately
     (do not construct `Webhook("")`).
  2. Read the **raw** body via `await req.text()` (required for signature verification —
     do not `req.json()` first).
  3. Build a headers object and verify with
     `new Webhook(secret).verify(rawBody, headers)`, where
     `secret = SEND_SMS_HOOK_SECRET.replace("v1,whsec_", "")`. The library enforces a
     hardcoded 300s timestamp tolerance, so a stale/replayed request also throws here.
     On throw (bad signature or stale timestamp) → return 401, no Sinch call (R2).
  4. Extract `{ user: { phone }, sms: { otp } }` from the verified payload.
  5. Resolve recipient to E.164: accept a leading `+`, or convert a single `00` prefix to
     `+`; otherwise **reject** (return 422, no Sinch call) — do not blindly prefix `+` (R7).
  6. POST to `https://${SINCH_SMS_REGION ?? "eu"}.sms.api.sinch.com/xms/v1/${SINCH_SERVICE_PLAN_ID}/batches`
     with header `Authorization: Bearer ${SINCH_API_TOKEN}` and body
     `{ from: SINCH_FROM, to: [recipient], body: "Your Geneva Polo Club verification code is ${otp}" }`.
  7. On Sinch non-2xx → return that status with a **fixed-template** JSON error
     `{ error: { http_code: <status>, message: "Sinch send failed (HTTP <status>)" } }` —
     never the raw Sinch response body, which can echo the OTP-bearing request (R4, R8).
     On success → `new Response("{}", { status: 200 })`.
  8. Logging (R8): log only a request id, **masked** recipient (last 4 digits), and the
     Sinch HTTP status. Never log `otp`, the message body, or the full verified payload.
- **Patterns to follow:** mirror Supabase's official Send SMS Hook Edge Function example
  (Deno.serve + standardwebhooks), substituting the Sinch call for the Twilio call. No
  existing edge functions in this repo to mirror (`supabase/functions/` is new).
- **Technical design (directional, not implementation spec):**
  ```ts
  Deno.serve(async (req) => {
    const rawSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
    if (!rawSecret) return new Response("misconfigured", { status: 500 });
    const secret = rawSecret.replace("v1,whsec_", "");
    const raw = await req.text();
    const headers = Object.fromEntries(req.headers);
    let data: { user: { phone: string }; sms: { otp: string } };
    try { data = new Webhook(secret).verify(raw, headers) as any; } // lib enforces 300s tolerance
    catch { return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 }); }
    // resolve E.164 recipient (reject → 422), POST to Sinch,
    // map result → 200 {} | fixed-template upstream error (never echo Sinch body)
  });
  ```
- **Test scenarios** (no Deno test harness exists in this repo; validate via the manual
  cases in Verification, optionally codified as a `deno test`):
  - **Happy path:** valid signed payload → exactly one POST to the region URL with
    `Authorization: Bearer …`, `to: ["+<phone>"]`, body containing the 6-digit OTP →
    response is `200` with empty `{}`. *Covers R1, R4.*
  - **Signature rejection (error path):** missing or tampered signature header → `401`,
    and **no** outbound Sinch request. *Covers R2.*
  - **Region override (edge):** with `SINCH_SMS_REGION=us`, the request targets
    `us.sms.api.sinch.com`; unset → defaults to `eu`. *Covers R3.*
  - **E.164 recipient handling (edge):** `+41…` passes through; `0041…` → `+41…`; spaces
    stripped; a non-E.164 value (national format like `079…`, letters, or empty) → **422
    with no Sinch call**. (Syntactic E.164 only — Sinch handles deliverability of a
    well-formed but wrong number; per-country length validation is out of scope.) *Covers R7.*
  - **Replay/stale signature (error path):** a validly-signed payload with a timestamp
    older than 300s → `401`, no Sinch call. *Covers R2.*
  - **Missing secret (error path):** `SEND_SMS_HOOK_SECRET` unset → `500` before any
    verification, no Sinch call.
  - **Sinch failure does not leak OTP (error path):** Sinch responds 400 echoing the
    request → function returns the upstream status with the **fixed-template** message
    only; the OTP must not appear in the response or logs. *Covers R4, R8.*
- **Verification:** deployed function logs (masked phone + Sinch status, no OTP) show
  signature-verified requests and a 2xx Sinch response; an end-to-end
  `signInWithOtp({ phone })` delivers an SMS.

### U2. `supabase/config.toml` (CLI-deploy documentation only)

- **Goal:** Record `verify_jwt = false` for any future CLI deploy. **The actual JWT
  disable for this plan happens via the MCP deploy parameter (see Deployment), not this
  file** — the MCP `deploy_edge_function` tool ignores `config.toml`.
- **Requirements:** R1 (precondition).
- **Dependencies:** U1.
- **Files:** `supabase/config.toml` (create)
- **Approach:** Minimal file with `project_id = "rmchkoktpzoojlglyfca"` and a
  `[functions.sinch-sms]` block setting `verify_jwt = false`. This is documentation/parity
  for `supabase functions deploy`; it has no effect on the MCP deploy path. Optional — if
  we only ever deploy via MCP, this unit can be skipped, but it's cheap insurance against a
  later CLI deploy silently re-enabling JWT.
- **Patterns to follow:** standard Supabase CLI `config.toml` schema; keep it minimal —
  do not scaffold unrelated config sections.
- **Test expectation: none** — configuration only; the real JWT-off behavior is exercised
  by U1's E2E verification (a JWT-gated function would 401 the hook before U1 runs).

---

## Deployment & Configuration (post-code; not code units)

**Code steps (I do):**
1. Create U1 + U2 files.
2. Deploy via Supabase MCP `deploy_edge_function` to project `rmchkoktpzoojlglyfca`,
   **passing `verify_jwt: false` explicitly** (the tool defaults it to `true` and ignores
   `config.toml`). Confirm JWT is **off** for `sinch-sms` in the dashboard afterward.

**Owner steps (you do — MCP cannot set secrets or toggle auth providers/hooks):**
3. Set Edge Function secrets (Dashboard → Edge Functions → Secrets, or CLI):

   | Secret | Source |
   |---|---|
   | `SINCH_SERVICE_PLAN_ID` | Sinch → SMS → APIs → REST (service plan id in the URL) |
   | `SINCH_API_TOKEN` | same page (Bearer token) |
   | `SINCH_FROM` | your Sinch virtual number or alphanumeric sender |
   | `SINCH_SMS_REGION` | the host in the REST endpoint: `eu` / `us` / `au` / `br` / `ca` |
   | `SEND_SMS_HOOK_SECRET` | generated when you enable the hook (step 5) — full `v1,whsec_…` |

   CLI form: `supabase secrets set SINCH_SERVICE_PLAN_ID="…" SINCH_API_TOKEN="…" SINCH_FROM="…" SINCH_SMS_REGION="eu" SEND_SMS_HOOK_SECRET="v1,whsec_…"`

**Enable steps (gated on the Open Questions decision — see below):** these are what make
the hook *live* and the paid SMS endpoint reachable. Defer them until app-side phone login
is ready, unless you deliberately choose to enable now for testing.
4. **Auth → Providers → Phone:** enable; keep existing dummy creds; do **not** select
   "Twilio Verify". Confirm the dummy-cred save succeeds (the provider-stub behavior is
   unverified — see Key Technical Decisions).
5. **Auth → Hooks → Send SMS Hook:** enable, type **HTTPS**, endpoint
   `https://rmchkoktpzoojlglyfca.supabase.co/functions/v1/sinch-sms`. Copy the generated
   secret → set it as `SEND_SMS_HOOK_SECRET` (step 3). Sequence matters: deploy → enable
   hook → copy secret → set secret → test.
6. **Set a Sinch spend cap / balance alert** before enabling, as the compensating control
   for cost-amplification (see Risks). Note the Supabase Auth phone OTP rate-limit setting.

---

## Verification

- **Isolate Sinch creds/region first (cheapest signal):** curl the Sinch API directly
  from your machine:
  ```
  curl -i -X POST https://eu.sms.api.sinch.com/xms/v1/$PLAN/batches \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"from":"<SINCH_FROM>","to":["+41…your mobile"],"body":"sinch test"}'
  ```
  A 2xx + received SMS confirms region + creds before Supabase is involved.
- **Signature rejection:** `curl -i -X POST <function-url> -d '{}'` with no valid
  signature → expect `401`.
- **End-to-end (requires the enable steps + a test number):** there is **no app caller
  yet** — phone login is deferred — so the only trigger is a manual probe:
  `await supabase.auth.signInWithOtp({ phone: "+41…your mobile" })` run from a console
  against the project. A green probe proves the pipeline, not the feature. Define the probe
  env (which key, which number) before running. If you keep the provider disabled (the
  default), this step waits until phone login ships.
- **Logs:** Edge Function logs (MCP `get_logs` or dashboard) show masked phone + Sinch
  status for triage — **no OTP** (R8).

---

## Scope Boundaries

**In scope:** the `sinch-sms` Edge Function, its `config.toml`, MCP deployment, and the
secrets/dashboard configuration to make phone-OTP delivery work via Sinch.

### Deferred to Follow-Up Work
- **App-side phone login** — adding a phone OTP path to `app/actions/auth.ts` and the
  member/admin login forms (`signInWithOtp({ phone })` / `verifyOtp({ type: "sms" })`).
- **Member identity model for phone** — how a phone login resolves to an existing
  (email-keyed) member without creating a split auth account; this is the open design
  question we set aside. Email-vs-phone unification, member-table phone normalization
  (118/151 members have phones, with inconsistent `00`/malformed formats), and admin
  phone access all belong to that follow-up.
- **Automated Deno tests** for the function — optional; primary verification here is the
  manual E2E above, since the repo has no edge-function test harness today.

---

## Risks & Notes

- **Region mismatch** is the top failure mode — the direct Sinch curl de-risks it first;
  `SINCH_SMS_REGION` makes the fix a secret change, not a redeploy.
- **Alphanumeric sender IDs** work for one-way OTP in CH/EU but can't receive replies and
  some destinations require pre-registration; a Sinch virtual number is the safe default
  for `SINCH_FROM`. Note Sinch returns 2xx on *batch accept*, not delivery — an
  unregistered sender can yield a green response yet zero delivery, so confirm an actual
  SMS lands during the curl test, not just the HTTP status.
- **Cost / SMS-pumping:** once enabled, a valid signed request is relayed to Sinch
  unconditionally, and every phone OTP is a paid SMS. Supabase Auth's built-in OTP rate
  limits are the primary control; a Sinch spend cap/alert is the last-resort backstop
  (deploy step 6). Toll-fraud against OTP endpoints is a known cost-amplification vector —
  re-review the rate-limit posture before app-side phone login exposes the endpoint widely.
- **Secret ordering:** the hook secret only exists after the hook is enabled, so the
  function will 401 until `SEND_SMS_HOOK_SECRET` is set, and 500 if the env var is entirely
  absent (the explicit guard) — both expected, not bugs.
- **Sinch API surface assumption:** this plan assumes the **service-plan-ID + API-token
  (Bearer)** XMS REST product. If the account is instead provisioned on Sinch's newer
  project-ID + OAuth API, the endpoint and auth differ — verify which product the dashboard
  exposes before wiring secrets.

---

## Open Questions

- **Enable on prod now, or deploy dormant?** *(owner decision — review-raised, root of the
  sequencing findings.)* App-side phone login is deferred, so enabling the Phone provider +
  hook now opens a public, paid, abusable `signInWithOtp({ phone })` endpoint with only a
  hand-typed probe as a consumer. **Plan default: deploy the function, set secrets, but
  leave the provider/hook disabled** (steps 4–6 gated) until phone login is ready — lowest
  cost/abuse exposure, fully reversible. Choose to enable now only if you want to validate
  end-to-end before then, with a Sinch spend cap in place.
- **Deferred (revisit with phone login):** member identity unification (a phone-keyed auth
  user won't match the email-keyed member record → orphaned account), `members.phone`
  normalization for the 118/151 with inconsistent formats, and the Supabase Auth phone
  rate-limit values that bound maximum spend.
