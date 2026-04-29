import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Postmark SubscriptionChange webhook handler.
 *
 * Postmark fires this when a recipient unsubscribes (footer link, list-
 * unsubscribe header, or manual suppression in the Postmark dashboard) and
 * when a previously suppressed recipient is reactivated.
 *
 * Postmark does NOT sign these webhooks. The standard mitigation per their
 * docs is to gate the URL with a shared secret — we expect ?token=<secret>
 * matching POSTMARK_WEBHOOK_TOKEN.
 *
 * We always return 200 on validated requests so Postmark does not retry on
 * application-level no-ops (e.g. unknown email).
 */
export async function POST(request: NextRequest) {
  const expectedToken = process.env.POSTMARK_WEBHOOK_TOKEN;
  const providedToken = request.nextUrl.searchParams.get("token");

  if (!expectedToken) {
    console.error("[postmark-unsubscribe] POSTMARK_WEBHOOK_TOKEN not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Postmark SubscriptionChange shape:
  //   { Recipient, Origin, SuppressSending, SuppressionReason, ChangedAt, MessageStream, ... }
  // SuppressSending is a boolean: true = suppressed (unsubscribed), false = reactivated.
  const recipient = typeof payload.Recipient === "string"
    ? payload.Recipient.toLowerCase()
    : null;

  if (!recipient) {
    console.warn("[postmark-unsubscribe] missing Recipient in payload", payload);
    return NextResponse.json({ received: true });
  }

  const suppressSending = Boolean(payload.SuppressSending);

  const adminClient = createAdminClient();

  const { data: members, error: lookupErr } = await adminClient
    .from("members")
    .select("id, email")
    .eq("email", recipient)
    .limit(1);

  if (lookupErr) {
    console.error(
      "[postmark-unsubscribe] member lookup failed",
      lookupErr,
      recipient
    );
    return NextResponse.json({ received: true });
  }

  if (!members || members.length === 0) {
    console.log(
      "[postmark-unsubscribe] no member matches recipient — no-op",
      recipient
    );
    return NextResponse.json({ received: true });
  }

  const memberId = members[0].id;
  const newConsent = !suppressSending;

  const { error: updateErr } = await adminClient
    .from("members")
    .update({ marketing_consent: newConsent })
    .eq("id", memberId);

  if (updateErr) {
    console.error(
      "[postmark-unsubscribe] failed to update marketing_consent",
      updateErr,
      memberId
    );
    return NextResponse.json({ received: true });
  }

  console.log(
    "[postmark-unsubscribe] updated marketing_consent",
    { memberId, recipient, newConsent }
  );

  return NextResponse.json({ received: true });
}
