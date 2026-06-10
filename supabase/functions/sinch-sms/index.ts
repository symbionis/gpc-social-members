/// <reference lib="deno.ns" />
// Supabase Send SMS Hook → Sinch SMS REST API bridge.
//
// Supabase Auth generates the phone OTP, then POSTs a Standard-Webhooks-signed
// payload here. We verify the signature and relay the code via Sinch. Sinch is
// not a native Supabase provider, so this Edge Function is the bridge.
//
// The function is deployed with JWT verification OFF (the hook authenticates via
// the Standard Webhooks signature, not a Supabase JWT), so signature verification
// below is the ONLY thing standing between the public internet and paid SMS sends.
//
// Secrets (set via `supabase secrets set` or the dashboard):
//   SEND_SMS_HOOK_SECRET   - the hook secret, full "v1,whsec_<base64>" value
//   SINCH_SERVICE_PLAN_ID  - Sinch service plan id (in the REST endpoint path)
//   SINCH_API_TOKEN        - Sinch API token (Bearer auth)
//   SINCH_FROM             - sender: Sinch virtual number or alphanumeric sender id
//   SINCH_SMS_REGION       - "eu" | "us" | "au" | "br" | "ca" (defaults to "eu")

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// E.164: leading "+", first digit 1-9, total 8-15 digits.
const E164 = /^\+[1-9]\d{6,14}$/;

// Resolve a hook-payload phone to a strict E.164 string, or null if it cannot be
// trusted. We do NOT blindly prepend "+": the member base has inconsistent phone
// data (raw "00…" prefixes, malformed entries), and a bad number means a paid SMS
// sent to garbage. Reject rather than guess.
function resolveE164(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let p = raw.trim().replace(/[\s\-()]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  return E164.test(p) ? p : null;
}

// Mask all but the last 4 digits for safe logging — never log the OTP or full payload.
function maskPhone(p: string): string {
  return p.length <= 4 ? "****" : `${"*".repeat(p.length - 4)}${p.slice(-4)}`;
}

interface HookPayload {
  user: { phone?: string | null };
  sms: { otp: string };
}

Deno.serve(async (req) => {
  // 1. Config guard: never construct Webhook("") — its empty-secret behavior is
  //    unspecified, and this is reachable during the deploy-before-secret window.
  const rawSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!rawSecret) {
    console.error("sinch-sms: SEND_SMS_HOOK_SECRET is not set");
    return new Response(JSON.stringify({ error: "misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  // standardwebhooks expects the base64 secret without the "v1,whsec_" prefix.
  const secret = rawSecret.replace("v1,whsec_", "");

  // 2. Raw body is required for signature verification — do not parse first.
  const body = await req.text();
  const headers = Object.fromEntries(req.headers);

  // 3. Verify signature + timestamp. standardwebhooks enforces a hardcoded 300s
  //    timestamp tolerance, which blocks replay of a captured signed request.
  //    Any failure (bad signature or stale timestamp) → 401, no Sinch call.
  let payload: HookPayload;
  try {
    payload = new Webhook(secret).verify(body, headers) as HookPayload;
  } catch (_err) {
    return new Response(JSON.stringify({ error: "invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Resolve recipient to strict E.164, or reject (422) before spending an SMS.
  const recipient = resolveE164(payload.user?.phone);
  if (!recipient) {
    console.error("sinch-sms: recipient is not valid E.164; rejecting");
    return new Response(JSON.stringify({ error: "recipient not E.164" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 5. Relay via Sinch SMS REST API (region-configurable endpoint).
  const region = Deno.env.get("SINCH_SMS_REGION") ?? "eu";
  const planId = Deno.env.get("SINCH_SERVICE_PLAN_ID");
  const token = Deno.env.get("SINCH_API_TOKEN");
  const from = Deno.env.get("SINCH_FROM");
  if (!planId || !token || !from) {
    console.error("sinch-sms: missing Sinch configuration");
    return new Response(JSON.stringify({ error: "misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sinchRes = await fetch(
    `https://${region}.sms.api.sinch.com/xms/v1/${planId}/batches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        body: `Your Geneva Polo Club verification code is ${payload.sms.otp}`,
      }),
    },
  );

  // 6. Map Sinch result. On failure, return a FIXED-TEMPLATE message — never the
  //    raw Sinch body, which can echo our OTP-bearing request into Supabase logs.
  if (!sinchRes.ok) {
    // Drain the body so the connection can be reused, but never surface or log it.
    await sinchRes.text().catch(() => undefined);
    console.error(
      `sinch-sms: Sinch send failed to=${
        maskPhone(recipient)
      } status=${sinchRes.status}`,
    );
    return new Response(
      JSON.stringify({
        error: {
          http_code: sinchRes.status,
          message: `Sinch send failed (HTTP ${sinchRes.status})`,
        },
      }),
      {
        status: sinchRes.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  console.log(
    `sinch-sms: sent to=${maskPhone(recipient)} status=${sinchRes.status}`,
  );

  // 7. Supabase success contract: HTTP 200 with empty JSON body.
  return new Response("{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
