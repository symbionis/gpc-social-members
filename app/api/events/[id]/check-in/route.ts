import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchContact, recordAttendeeCheckin } from "@/lib/events/checkin";
import { type WaiverLanguage } from "@/lib/events/waiver";

// Public, unauthenticated door check-in submit. The door is a strict gate for every
// event: the arrival's phone/email is matched against the roster (event_attendees).
// Matched → check in (signing the waiver now if unsigned); not matched → not-found,
// "please see the welcome desk" (no routing, no registration path — the kiosk never
// registers). Idempotent: re-checking-in an already-arrived attendee returns the
// original arrival time. Uses the service-role client.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = ["fr", "en"] as const;
const MAX_LEN = 200;
const MAX_EMAIL_LEN = 254; // RFC 5321
const MAX_PHONE_LEN = 20; // E.164 max 15 digits + '+'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  let body: {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    language?: unknown;
    waiverAccepted?: unknown;
    marketingConsent?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const language = typeof body.language === "string" ? body.language : "";
  const waiverAccepted = body.waiverAccepted === true;
  // Optional communication consent — ticked by default in the form, so anything
  // other than an explicit `false` is treated as consent given.
  const marketingConsent = body.marketingConsent !== false;

  if (!name) return bad("name is required");
  if (name.length > MAX_LEN) return bad("name is too long");
  if (email && !EMAIL_RE.test(email)) return bad("a valid email is required");
  if (email.length > MAX_EMAIL_LEN) return bad("email is too long");
  if (phone.length > MAX_PHONE_LEN) return bad("phone is too long");
  if (!email && !phone) return bad("an email or phone is required");
  if (!LANGUAGES.includes(language as WaiverLanguage)) {
    return bad("language must be 'fr' or 'en'");
  }

  const lang = language as WaiverLanguage;

  const supabase = createAdminClient();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, is_published")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();

  if (eventError) {
    console.error("[event-checkin] event lookup failed", { eventId, err: eventError });
    return bad("Service temporarily unavailable", 503);
  }
  if (!event || !event.is_published) return bad("Event not found", 404);

  try {
    // Match the arrival to a roster attendee (authoritative — never trust the
    // client's earlier advisory call).
    const match = await matchContact(eventId, {
      email: email || null,
      phone: phone || null,
    });

    if (match.kind === "none") {
      // Strict gate: not on the roster → "see the welcome desk". No routing data.
      return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    }

    const result = await recordAttendeeCheckin({
      eventId,
      attendeeId: match.attendeeId,
      language: lang,
      marketingConsent,
      waiverAccepted,
    });

    if (!result.ok) {
      if (result.reason === "needs_waiver") {
        return NextResponse.json({ ok: false, reason: "needs_waiver" }, { status: 400 });
      }
      // The attendee row vanished between match and record (e.g. admin freed it).
      return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      name,
      checkedInAt: result.checkedInAt,
      already: result.already,
    });
  } catch (err) {
    console.error("[event-checkin] record failed", { eventId, err });
    return bad("Could not record check-in", 500);
  }
}
