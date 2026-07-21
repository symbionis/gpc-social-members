import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTicketQrEmail } from "@/lib/email/ticket-qr";

// Lead "My Booking" page: name one ticket by id (U4). Public, authorised by the
// booking's manage_token in the path — the fill_ticket RPC re-validates the token,
// scopes the ticket to that booking, enforces the contact rule, and names the exact
// ticket so its QR stays bound to that person. The token is never echoed back.
//
// Naming a ticket also emails that guest their own entry QR ("no QR, no bracelet") —
// every ticket, no exemption (R8). This is the lead's whole delivery mechanism — the
// lead names the party, each guest gets their QR, and the ticket stays with the
// booking (never forwarded), so the lead can still upgrade it.

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

  let body: {
    ticketId?: unknown;
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    marketingConsent?: unknown;
  };
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
  // Ticked-by-default consent: anything other than an explicit false is consent.
  const marketingConsent = body.marketingConsent !== false;

  if (!ticketId) return bad("ticketId is required");
  if (!name) return bad("a name is required");
  if (name.length > MAX_LEN) return bad("name is too long");
  if (email && (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN)) {
    return bad("a valid email is required");
  }
  if (phone && !PHONE_RE.test(phone)) return bad("a valid phone is required");

  const supabase = createAdminClient();

  // Dual-token (U11): the path token is EITHER the booking's registration manage_token
  // (lead "My Booking" flow) OR a per-ticket manage_token (a household member correcting
  // from the manage page). fill_ticket authorises on the REGISTRATION manage_token, so for
  // the holder flow we resolve the ticket's registration and use its token; a household
  // member may correct only tickets sharing their email. `householdEmail` null ⇒ lead.
  let regId: string;
  let regToken: string; // the registration manage_token passed to fill_ticket
  let householdEmail: string | null = null;
  let selfTicketId: string | null = null; // set in the holder flow (the token's own ticket)

  const { data: regByToken } = await supabase
    .from("event_registrations")
    .select("id")
    .eq("manage_token", token)
    .maybeSingle();
  if (regByToken) {
    regId = regByToken.id as string;
    regToken = token;
  } else {
    const { data: self } = await supabase
      .from("tickets")
      .select("id, registration_id, email")
      .eq("manage_token", token)
      .is("released_at", null)
      .maybeSingle();
    if (!self || !self.registration_id) return bad("Ticket not found", 404);
    selfTicketId = self.id as string;
    const { data: r } = await supabase
      .from("event_registrations")
      .select("id, manage_token")
      .eq("id", self.registration_id as string)
      .maybeSingle();
    if (!r) return bad("Ticket not found", 404);
    regId = r.id as string;
    regToken = r.manage_token as string;
    householdEmail = ((self.email as string | null) ?? "").trim().toLowerCase();
  }

  // Resolve the ticket within THIS booking so the prior email read reflects the real row,
  // not a client claim. The QR is delivered by email, so every ticket needs an email (R8).
  const { data: tk } = await supabase
    .from("tickets")
    .select("email, qr_email_sent_at")
    .eq("id", ticketId)
    .eq("registration_id", regId)
    .maybeSingle();
  if (!tk) return bad("Ticket not found", 404);
  // A household member can only correct tickets on their own email (what the manage page
  // shows them). Mirror lib/events/household.ts: a blank self-email household is SOLO — fall
  // back to the caller's own ticket id so blank-email tickets don't collapse together.
  if (householdEmail !== null) {
    const targetEmail = ((tk.email as string | null) ?? "").trim().toLowerCase();
    const sameHousehold =
      householdEmail !== "" ? targetEmail === householdEmail : ticketId === selfTicketId;
    if (!sameHousehold) return bad("Ticket not found", 404);
  }
  if (!email) {
    return bad("an email is required so we can send the guest their QR code");
  }

  // A lead correcting a typo'd address must be able to re-send: sendTicketQrEmail is
  // idempotent on qr_email_sent_at, so a changed email needs that stamp cleared or the
  // QR would stay stuck at the wrong inbox. Same address → no clear, no double-send.
  const emailChanged =
    Boolean(email) && ((tk.email as string | null) ?? "").trim().toLowerCase() !== email;

  const { data: result, error } = await supabase.rpc("fill_ticket", {
    p_manage_token: regToken,
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
    console.error("[booking-fill] fill_ticket failed", { err: error });
    return bad("Could not save", 500);
  }

  const fill = (result ?? {}) as { status?: string; attendee_id?: string; name?: string };
  switch (fill.status) {
    case "claimed": {
      // Email this guest their own entry QR. Best-effort: a send failure never fails the
      // save — the name is already on the roster, and a NULL qr_email_sent_at leaves the
      // ticket eligible for a retry on the next save.
      if (email && fill.attendee_id) {
        if (emailChanged && tk.qr_email_sent_at) {
          const { error: clearErr } = await supabase
            .from("tickets")
            .update({ qr_email_sent_at: null })
            .eq("id", ticketId);
          if (clearErr) {
            console.error("[booking-fill] could not clear qr_email_sent_at", { err: clearErr });
          }
        }
        await sendTicketQrEmail(fill.attendee_id).catch((err) =>
          console.error("[booking-fill] guest QR send failed", { err })
        );
      }
      return NextResponse.json({ ok: true, ticketId: fill.attendee_id, name: fill.name });
    }
    case "invalid_input":
      return bad("Enter a name and a valid email so we can send this guest their QR code.");
    case "not_found":
      return bad("Ticket not found", 404);
    case "inactive":
      return NextResponse.json({ ok: false, reason: "inactive" }, { status: 409 });
    case "invalid":
    default:
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 404 });
  }
}
