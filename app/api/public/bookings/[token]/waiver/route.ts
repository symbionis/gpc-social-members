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
// (p_waiver_accepted: false).
//
// Auth mirrors cancel/convert in SHAPE only: the path token is EITHER the booking's
// registration manage_token (the lead) OR a per-ticket manage_token. It deliberately does
// NOT mirror their AUTHORITY. Cancel and convert give the lead free rein over every seat in
// the booking, which is right — the lead paid, so the lead may move their own seats. That
// does not transfer here. Authority over a seat is not authority to attest on behalf of the
// person sitting in it, so the email restriction applies to BOTH paths: a caller may sign
// only tickets on their own email, lead included. Guests on other addresses sign via the
// per-ticket link they were sent.
//
// Same-email is treated as the same person on purpose (owner decision, 2026-08-11): a
// household books on one address and hands the phone around. That is the household the page
// already shows; it is not a licence to reach across addresses.
//
// WAIVER_VERSION is sourced server-side and never accepted from the client — the same rule
// the door route follows. A client that could name its own version could record acceptance
// of text the guest never saw.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGES = ["en", "fr"] as const;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Our fault, not theirs. Logged so an outage is visible rather than showing up as a spike of
// "Booking not found" that reads like guests mistyping links.
function oops(what: string, err: unknown) {
  console.error(`[bookings/waiver] ${what}`, err);
  return bad("Something went wrong on our side. Please try again.", 500);
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
  // The caller's own address, normalised. Always set on both token paths — the lead's from
  // the registration, a member's from their ticket — because both are restricted to it.
  let householdEmail = "";
  let selfTicketId: string | null = null;

  // Every read below binds `error`. A DB fault must surface as a 500 the guest can retry and
  // we can see in the logs — never as a 404/409 that blames their link for our outage.
  const { data: regByToken, error: regByTokenErr } = await supabase
    .from("event_registrations")
    .select("id, status, email")
    .eq("manage_token", token)
    .limit(1)
    .maybeSingle();
  if (regByTokenErr) return oops("registration lookup by token failed", regByTokenErr);
  if (regByToken) {
    reg = regByToken as RegRow;
    // The lead is scoped to their own address exactly like anyone else — see the header.
    householdEmail = ((regByToken.email as string | null) ?? "").trim().toLowerCase();
  } else {
    const { data: self, error: selfErr } = await supabase
      .from("tickets")
      .select("id, registration_id, email")
      .eq("manage_token", token)
      .is("released_at", null)
      .limit(1)
      .maybeSingle();
    if (selfErr) return oops("ticket lookup by token failed", selfErr);
    if (!self || !self.registration_id) return bad("Booking not found", 404);
    selfTicketId = self.id as string;
    const { data: r, error: rErr } = await supabase
      .from("event_registrations")
      .select("id, status, email")
      .eq("id", self.registration_id as string)
      .limit(1)
      .maybeSingle();
    if (rErr) return oops("registration lookup by id failed", rErr);
    if (!r) return bad("Booking not found", 404);
    reg = r as RegRow;
    householdEmail = ((self.email as string | null) ?? "").trim().toLowerCase();
  }
  if (reg.status !== "paid" && reg.status !== "free") {
    return bad("This booking isn’t confirmed yet", 409);
  }

  const { data: ticket, error: ticketErr } = await supabase
    .from("tickets")
    .select("id, name, email, waiver_accepted_at, cancellation_status")
    .eq("id", ticketId)
    .eq("registration_id", reg.id)
    .is("released_at", null)
    .in("slot_status", ["issued", "claimed"])
    .limit(1)
    .maybeSingle();
  if (ticketErr) return oops("ticket lookup failed", ticketErr);
  if (!ticket) return bad("This ticket can’t be signed", 409);

  // Own email only, on BOTH token paths — see the header. A blank-email household is SOLO
  // (matches only the caller's own ticket) rather than every other blank-email row.
  const targetEmail = ((ticket.email as string | null) ?? "").trim().toLowerCase();
  const sameHousehold =
    householdEmail !== "" ? targetEmail === householdEmail : ticket.id === selfTicketId;
  if (!sameHousehold) return bad("This ticket can’t be signed", 409);

  if (ticket.cancellation_status !== null) {
    return bad("This ticket has been cancelled", 409);
  }

  // An acceptance has to attest to a PERSON. Signing a seat with nobody on it records a
  // waiver against a row that can still be handed to anyone — and fill_ticket now clears the
  // acceptance when a name or email changes, so an unnamed signature could never survive
  // being assigned anyway. Refuse it here rather than write something that gets wiped.
  if (((ticket.name as string | null) ?? "").trim() === "") {
    return bad("Name this ticket before signing the waiver", 409);
  }

  // Idempotent, and deliberately NOT a re-stamp: a waiver already accepted keeps its original
  // version, timestamp and language. Re-signing would silently move a guest onto a version
  // they may never have read.
  if (ticket.waiver_accepted_at !== null) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { data: written, error } = await supabase
    .from("tickets")
    .update({
      waiver_version: WAIVER_VERSION,
      waiver_accepted_at: new Date().toISOString(),
      language,
      marketing_consent: marketingConsent,
    })
    .eq("id", ticketId)
    // The read above authorised THIS ticket in THIS booking, live and issued/claimed. Re-assert
    // all of it: cancel is reachable from the same page in another tab, so between the two
    // statements the row can leave the set we authorised. Without these the waiver could be
    // stamped onto a seat that was cancelled mid-request.
    .eq("registration_id", reg.id)
    .is("released_at", null)
    .in("slot_status", ["issued", "claimed"])
    .is("cancellation_status", null)
    // Guard on still-unsigned so two tabs racing cannot overwrite the first acceptance.
    .is("waiver_accepted_at", null)
    // Not decoration: without it `error === null` only means the statement ran, not that a row
    // changed, and every zero-row outcome would report success to a guest who signed nothing.
    .select("id");
  if (error) {
    console.error("[bookings/waiver] could not record acceptance", { ticketId, err: error });
    return bad("Could not record your acceptance. Please try again.", 500);
  }

  if (!written || written.length === 0) {
    // Zero rows means one of the guards above rejected it. Only one of those is benign —
    // another tab signed first — and it is not safe to assume that one. Re-read and let the
    // row say which happened, mirroring recordAttendeeCheckin (lib/events/checkin.ts).
    const { data: existing, error: reReadErr } = await supabase
      .from("tickets")
      .select("waiver_accepted_at")
      .eq("id", ticketId)
      .maybeSingle();
    if (reReadErr) return oops("re-read after a zero-row waiver update failed", reReadErr);
    if (existing?.waiver_accepted_at) {
      return NextResponse.json({ ok: true, already: true });
    }
    console.error("[bookings/waiver] update matched no row and the ticket is still unsigned", {
      ticketId,
      registrationId: reg.id,
    });
    return bad("Could not record your acceptance. Please try again.", 500);
  }

  return NextResponse.json({ ok: true });
}
