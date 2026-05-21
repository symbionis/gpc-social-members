import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  matchEmail,
  recordCheckin,
  findExistingCheckin,
} from "@/lib/events/checkin";
import { type WaiverLanguage } from "@/lib/events/waiver";

// Public, unauthenticated door check-in submit. Validates input, re-derives the
// match server-side (authoritative — the match endpoint is advisory only),
// enforces the waiver and strict-mode rules, then records one event_checkins row.
// Uses the service-role client; the seat cap is intentionally NOT enforced here
// (it governs online registration, not the door).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = ["fr", "en"] as const;
const MAX_LEN = 200;
const MAX_EMAIL_LEN = 254; // RFC 5321

const MESSAGES = {
  fr: {
    blocked: "Veuillez vous adresser à l’accueil pour vous enregistrer.",
    inviter: "Veuillez indiquer qui vous a invité.",
  },
  en: {
    blocked: "Please see the welcome desk to check in.",
    inviter: "Please tell us who invited you.",
  },
} as const;

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
    language?: unknown;
    inviterName?: unknown;
    invitedByRegistrationId?: unknown;
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
  const language = typeof body.language === "string" ? body.language : "";
  const inviterName =
    typeof body.inviterName === "string" ? body.inviterName.trim() : "";
  const invitedByRegistrationId =
    typeof body.invitedByRegistrationId === "string"
      ? body.invitedByRegistrationId
      : null;
  const waiverAccepted = body.waiverAccepted === true;
  // Optional communication consent — ticked by default in the form, so anything
  // other than an explicit `false` is treated as consent given.
  const marketingConsent = body.marketingConsent !== false;

  if (!name) return bad("name is required");
  if (name.length > MAX_LEN) return bad("name is too long");
  if (!email || !EMAIL_RE.test(email)) return bad("valid email is required");
  if (email.length > MAX_EMAIL_LEN) return bad("email is too long");
  if (!LANGUAGES.includes(language as WaiverLanguage)) {
    return bad("language must be 'fr' or 'en'");
  }
  if (inviterName.length > MAX_LEN) return bad("inviter name is too long");
  if (!waiverAccepted) return bad("the waiver must be accepted");

  const lang = language as WaiverLanguage;

  const supabase = createAdminClient();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, is_published, strict_checkin")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();

  if (eventError) {
    console.error("[event-checkin] event lookup failed", { eventId, err: eventError });
    return bad("Service temporarily unavailable", 503);
  }
  if (!event || !event.is_published) return bad("Event not found", 404);

  try {
    // Authoritative match — never trust the client's earlier disclosure call.
    const match = await matchEmail(eventId, email);

    if (match.kind === "guest") {
      if (event.strict_checkin) {
        // Idempotency must hold even under strict: a person who already checked
        // in (e.g. before strict was turned on) still gets the green screen
        // rather than being sent to the desk.
        const existing = await findExistingCheckin(eventId, email);
        if (existing) {
          return NextResponse.json({
            ok: true,
            kind: "guest",
            name,
            checkedInAt: existing.checkedInAt,
            already: true,
          });
        }
        return bad(MESSAGES[lang].blocked, 403);
      }
      if (!inviterName) return bad(MESSAGES[lang].inviter, 400);
    }

    const result = await recordCheckin({
      eventId,
      name,
      email,
      language: lang,
      match,
      // inviterName / invitedByRegistrationId are recorded only for guests;
      // recordCheckin also guards this.
      inviterName: match.kind === "guest" ? inviterName : null,
      invitedByRegistrationId:
        match.kind === "guest" ? invitedByRegistrationId : null,
      marketingConsent,
    });

    return NextResponse.json({
      ok: true,
      kind: match.kind,
      name,
      checkedInAt: result.checkedInAt,
      already: result.already,
    });
  } catch (err) {
    console.error("[event-checkin] record failed", { eventId, email, err });
    return bad("Could not record check-in", 500);
  }
}
