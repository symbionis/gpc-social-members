import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Delegate batch page: name one ticket in a forwarded batch (U5). Public, authorised
// by the batch token in the path. fill_batch_ticket re-validates the token, rejects
// any ticket id not carrying it (so a delegate can only touch their batch), and
// applies the child/contact rule. The token is never echoed back.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEN = 200;
const MAX_EMAIL_LEN = 254;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return bad("Invalid link", 404);

  let body: { ticketId?: unknown; name?: unknown; email?: unknown; phone?: unknown; marketingConsent?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const ticketId =
    typeof body.ticketId === "string" && UUID_RE.test(body.ticketId) ? body.ticketId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const marketingConsent = body.marketingConsent !== false;

  if (!ticketId) return bad("ticketId is required");
  if (!name) return bad("a name is required");
  if (name.length > MAX_LEN) return bad("name is too long");
  if (email && (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN)) {
    return bad("a valid email is required");
  }
  if (phone && !PHONE_RE.test(phone)) return bad("a valid phone is required");

  const supabase = createAdminClient();
  const { data: result, error } = await supabase.rpc("fill_batch_ticket", {
    p_batch_token: token,
    p_ticket_id: ticketId,
    p_name: name,
    p_email: email || null,
    p_phone_e164: phone || null,
    p_language: null,
    p_waiver_version: null,
    p_waiver_accepted: false,
    p_marketing_consent: marketingConsent,
  });
  if (error) {
    console.error("[batch-fill] fill_batch_ticket failed", { err: error });
    return bad("Could not save", 500);
  }

  const fill = (result ?? {}) as { status?: string; attendee_id?: string; name?: string };
  switch (fill.status) {
    case "claimed":
      return NextResponse.json({ ok: true, ticketId: fill.attendee_id, name: fill.name });
    case "invalid_input":
      return bad("Enter a name, and an email or phone for adult tickets.");
    case "not_found":
      return bad("Ticket not found", 404);
    case "inactive":
      return NextResponse.json({ ok: false, reason: "inactive" }, { status: 409 });
    case "invalid":
    default:
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 404 });
  }
}
