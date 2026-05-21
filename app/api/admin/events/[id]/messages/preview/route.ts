import { NextResponse, type NextRequest } from "next/server";
import { requireEventsAdmin } from "@/lib/broadcast/event-auth";
import { parseEventMessagePayload } from "@/lib/broadcast/validate-event-message";
import { resolveEventAudience } from "@/lib/broadcast/event-audience";

/**
 * Recipient-count preview for an event message. Returns the resolved audience
 * size and the consent-skipped count for the selected kind + override, without
 * sending. Gated to events_admin / super_admin with an event-existence check.
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

  const parsed = parseEventMessagePayload(body, { forPreview: true });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { recipients, skipped } = await resolveEventAudience({
    event_id: id,
    kind: parsed.payload.kind,
    include_non_consented: parsed.payload.include_non_consented,
  });

  return NextResponse.json({
    recipient_count: recipients.length,
    skipped_count: skipped,
  });
}
