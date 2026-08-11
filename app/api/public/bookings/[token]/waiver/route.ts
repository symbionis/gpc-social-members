import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WAIVER_VERSION, type WaiverLanguage } from "@/lib/events/waiver";

// Accept the liability waiver in advance, from the guest manage page.
//
// The door has always honoured a pre-signed waiver — recordAttendeeCheckin skips its waiver
// step when waiver_accepted_at is set, and never re-stamps (lib/events/checkin.ts). That
// path was built for the retired self-registration flow and has been unreachable since:
// every other write path passes waiver_accepted false. This route reconnects it, so a guest
// who signs at home is waved through at the gate.
//
// ONE TICKET PER REQUEST, by decision. A manage_token opens a whole household (everyone on
// that email), so a single "accept" control would let one person sign for people who never
// saw the page — the same thing the codebase already refuses when a booker names a guest
// (p_waiver_accepted: false) or tries to opt one into marketing.
//
// Auth mirrors cancel/convert: the path token is EITHER the booking's registration
// manage_token (the lead) OR a per-ticket manage_token (a household member, restricted to
// tickets sharing their email).
//
// WAIVER_VERSION is sourced server-side and never accepted from the client — the same rule
// the door route follows. A client that could name its own version could record acceptance
// of text the guest never saw.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGES = ["en", "fr"] as const;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return bad("Invalid link", 404);

  let body: { ticketId?: unknown; language?: unknown; marketingConsent?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const ticketId =
    typeof body.ticketId === "string" && UUID_RE.test(body.ticketId) ? body.ticketId : "";
  if (!ticketId) return bad("Invalid request");

  const language = typeof body.language === "string" ? body.language : "";
  if (!LANGUAGES.includes(language as WaiverLanguage)) {
    return bad("language must be 'fr' or 'en' to sign the waiver");
  }
  // Pre-ticked at the door and here alike (owner decision, 2026-08-11): absent means yes.
  const marketingConsent = body.marketingConsent !== false;

  const supabase = createAdminClient();

  interface RegRow {
    id: string;
    status: string;
  }
  let reg: RegRow;
  let householdEmail: string | null = null;
  let selfTicketId: string | null = null;

  const { data: regByToken } = await supabase
    .from("event_registrations")
    .select("id, status")
    .eq("manage_token", token)
    .limit(1)
    .maybeSingle();
  if (regByToken) {
    reg = regByToken as RegRow;
  } else {
    const { data: self } = await supabase
      .from("tickets")
      .select("id, registration_id, email")
      .eq("manage_token", token)
      .is("released_at", null)
      .limit(1)
      .maybeSingle();
    if (!self || !self.registration_id) return bad("Booking not found", 404);
    selfTicketId = self.id as string;
    const { data: r } = await supabase
      .from("event_registrations")
      .select("id, status")
      .eq("id", self.registration_id as string)
      .limit(1)
      .maybeSingle();
    if (!r) return bad("Booking not found", 404);
    reg = r as RegRow;
    householdEmail = ((self.email as string | null) ?? "").trim().toLowerCase();
  }
  if (reg.status !== "paid" && reg.status !== "free") {
    return bad("This booking isn’t confirmed yet", 409);
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, email, waiver_accepted_at, cancellation_status")
    .eq("id", ticketId)
    .eq("registration_id", reg.id)
    .is("released_at", null)
    .in("slot_status", ["issued", "claimed"])
    .limit(1)
    .maybeSingle();
  if (!ticket) return bad("This ticket can’t be signed", 409);

  // A household member may only sign tickets on their own email — the set the manage page
  // shows them. A blank-email household is SOLO (matches only the caller's own ticket).
  if (householdEmail !== null) {
    const targetEmail = ((ticket.email as string | null) ?? "").trim().toLowerCase();
    const sameHousehold =
      householdEmail !== "" ? targetEmail === householdEmail : ticket.id === selfTicketId;
    if (!sameHousehold) return bad("This ticket can’t be signed", 409);
  }

  if (ticket.cancellation_status !== null) {
    return bad("This ticket has been cancelled", 409);
  }

  // Idempotent, and deliberately NOT a re-stamp: a waiver already accepted keeps its original
  // version, timestamp and language. Re-signing would silently move a guest onto a version
  // they may never have read.
  if (ticket.waiver_accepted_at !== null) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error } = await supabase
    .from("tickets")
    .update({
      waiver_version: WAIVER_VERSION,
      waiver_accepted_at: new Date().toISOString(),
      language,
      marketing_consent: marketingConsent,
    })
    .eq("id", ticketId)
    // Guard on still-unsigned so two tabs racing cannot overwrite the first acceptance.
    .is("waiver_accepted_at", null);
  if (error) {
    console.error("[bookings/waiver] could not record acceptance", { ticketId, err: error });
    return bad("Could not record your acceptance. Please try again.", 500);
  }

  return NextResponse.json({ ok: true });
}
