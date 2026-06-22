import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTicketForwardEmail } from "@/lib/email/ticket-forward";
import { formatDate } from "@/lib/format";

// Lead "My Booking" page: forward a batch of tickets to a delegate (U5). Public,
// authorised by the manage_token in the path. forward_ticket_batch stamps the chosen
// tickets with a fresh batch token (scoped to this booking); we then email the
// delegate a link to their batch page. One level — the delegate page has no re-forward.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 50;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return bad("Invalid link", 404);

  let body: { ticketIds?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const email =
    typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : "";
  const ticketIds = Array.isArray(body.ticketIds)
    ? body.ticketIds.filter((x): x is string => typeof x === "string" && UUID_RE.test(x))
    : [];

  if (!email || !EMAIL_RE.test(email)) return bad("a valid recipient email is required");
  if (ticketIds.length === 0) return bad("select at least one ticket to forward");
  if (ticketIds.length > MAX_BATCH) return bad("too many tickets in one batch");

  const supabase = createAdminClient();
  const { data: result, error } = await supabase.rpc("forward_ticket_batch", {
    p_manage_token: token,
    p_ticket_ids: ticketIds,
  });
  if (error) {
    console.error("[booking-forward] forward_ticket_batch failed", { err: error });
    return bad("Could not forward tickets", 500);
  }

  const fwd = (result ?? {}) as { status?: string; batch_token?: string; count?: number };
  if (fwd.status === "none") {
    return bad("None of those tickets can be forwarded (already checked in or removed)", 409);
  }
  if (fwd.status !== "ok" || !fwd.batch_token) {
    return NextResponse.json({ ok: false, reason: fwd.status ?? "invalid" }, { status: 404 });
  }

  // Resolve booking + event for the email (best-effort: the batch is already stamped).
  const { data: reg } = await supabase
    .from("event_registrations")
    .select("name, event_id")
    .eq("manage_token", token)
    .limit(1)
    .maybeSingle();
  let eventTitle = "the event";
  let eventDateLabel: string | null = null;
  if (reg?.event_id) {
    const { data: ev } = await supabase
      .from("events")
      .select("title, start_date")
      .eq("id", reg.event_id)
      .limit(1)
      .maybeSingle();
    if (ev) {
      eventTitle = (ev.title as string) ?? eventTitle;
      eventDateLabel = formatDate(ev.start_date as string);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const batchUrl = `${appUrl}/public/batches/${fwd.batch_token}`;

  await sendTicketForwardEmail({
    to: email,
    eventTitle,
    eventDateLabel,
    ticketCount: fwd.count ?? ticketIds.length,
    senderName: (reg?.name as string | null) ?? null,
    batchUrl,
  });

  return NextResponse.json({ ok: true, count: fwd.count, batchUrl });
}
