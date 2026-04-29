import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Postmark SubscriptionChange webhook handler.
 *
 * Postmark fires this when a recipient unsubscribes (footer link, list-
 * unsubscribe header, or manual suppression in the Postmark dashboard) and
 * when a previously suppressed recipient is reactivated in Postmark.
 *
 * We honour suppression (SuppressSending=true) by setting marketing_consent
 * to false. We DO NOT auto-re-enable consent on Postmark reactivation —
 * that would require explicit member action via a future preferences page,
 * not an admin un-suppressing in the Postmark dashboard.
 *
 * Postmark does not sign these webhooks. The standard mitigation is a
 * shared-secret token in the URL, compared in constant time.
 *
 * On internal failure (DB lookup or update) we return 500 so Postmark
 * retries. On unrecoverable application-level cases (unknown email,
 * malformed payload) we return 200 to avoid retry churn.
 */
export async function POST(request: NextRequest) {
  const expectedToken = process.env.POSTMARK_WEBHOOK_TOKEN;
  const providedToken = request.nextUrl.searchParams.get("token");

  if (!expectedToken) {
    console.error("[postmark-unsubscribe] POSTMARK_WEBHOOK_TOKEN not set");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }
  if (!providedToken || !constantTimeEquals(providedToken, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const recipient =
    typeof payload.Recipient === "string"
      ? payload.Recipient.toLowerCase()
      : null;

  if (!recipient) {
    console.warn("[postmark-unsubscribe] missing Recipient in payload");
    return NextResponse.json({ received: true });
  }

  const suppressSending = Boolean(payload.SuppressSending);

  // Only act on suppression events. Reactivation from Postmark's side does
  // not flip our flag — that requires explicit member action.
  if (!suppressSending) {
    return NextResponse.json({ received: true, ignored: "reactivation" });
  }

  const adminClient = createAdminClient();

  const { data: members, error: lookupErr } = await adminClient
    .from("members")
    .select("id")
    .ilike("email", recipient)
    .limit(1);

  if (lookupErr) {
    console.error(
      "[postmark-unsubscribe] member lookup failed — returning 500 for retry",
      lookupErr
    );
    return NextResponse.json(
      { error: "Member lookup failed" },
      { status: 500 }
    );
  }

  if (!members || members.length === 0) {
    // Unknown email — not retryable. Postmark may have suppressed an address
    // that never had an account on our side.
    return NextResponse.json({ received: true, ignored: "no_match" });
  }

  const memberId = members[0].id;

  const { error: updateErr } = await adminClient
    .from("members")
    .update({ marketing_consent: false })
    .eq("id", memberId);

  if (updateErr) {
    console.error(
      "[postmark-unsubscribe] failed to update marketing_consent — returning 500 for retry",
      updateErr
    );
    return NextResponse.json(
      { error: "Update failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true, suppressed: true });
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return timingSafeEqual(aBuf, bBuf);
}
