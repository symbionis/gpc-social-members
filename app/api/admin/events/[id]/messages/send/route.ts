import { NextResponse, type NextRequest } from "next/server";
import { requireEventsAdmin } from "@/lib/broadcast/event-auth";
import { parseEventMessagePayload } from "@/lib/broadcast/validate-event-message";
import { sendEventMessage } from "@/lib/broadcast/send";

/**
 * Send an event message (pre-event to registered attendees, post-event to
 * checked-in attendees). Gated to events_admin / super_admin with an
 * event-existence check.
 *
 * The double-send guard surfaces here as a friendly response, never a 500:
 *   - in_progress (another send for this event+kind is in flight) → 409
 *   - duplicate (same idempotency_key already ran) → 200 with the prior result
 *     and `deduplicated: true`
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await requireEventsAdmin(id);
  if (!auth.ok) {
    return NextResponse.json({ error: "Not authorized" }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseEventMessagePayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { kind, subject, body_html, include_non_consented, idempotency_key } =
    parsed.payload;

  try {
    const outcome = await sendEventMessage({
      event_id: id,
      kind,
      subject,
      body_html,
      include_non_consented,
      created_by: auth.admin.id,
      idempotency_key,
    });

    if (outcome.status === "in_progress") {
      return NextResponse.json(
        { error: "A message for this event is already being sent.", status: "in_progress" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ...outcome.result,
      deduplicated: outcome.status === "duplicate",
    });
  } catch (err) {
    // Adapter-wide failure (e.g. missing Postmark template/env). The broadcast
    // row is already marked 'failed' inside the dispatch core; surface a
    // structured 500 so the UI shows a real message, not an opaque error page.
    const message = err instanceof Error ? err.message : "Send failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
