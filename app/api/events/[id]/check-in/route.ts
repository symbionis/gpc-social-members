import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  matchEmail,
  recordCheckin,
  type CheckinLanguage,
} from "@/lib/events/checkin";

// Public, unauthenticated door check-in submit. Validates input, re-derives the
// match server-side (authoritative — the match endpoint is advisory only),
// enforces the waiver and strict-mode rules, then records one event_checkins row.
// Uses the service-role client; the seat cap is intentionally NOT enforced here
// (it governs online registration, not the door).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = ["fr", "en"] as const;
const MAX_LEN = 200;

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
    waiverAccepted?: unknown;
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
  const waiverAccepted = body.waiverAccepted === true;

  if (!name) return bad("name is required");
  if (name.length > MAX_LEN) return bad("name is too long");
  if (!email || !EMAIL_RE.test(email)) return bad("valid email is required");
  if (!LANGUAGES.includes(language as CheckinLanguage)) {
    return bad("language must be 'fr' or 'en'");
  }
  if (inviterName.length > MAX_LEN) return bad("inviter name is too long");
  if (!waiverAccepted) return bad("the waiver must be accepted");

  const lang = language as CheckinLanguage;

  const supabase = createAdminClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, is_published, strict_checkin")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();

  if (!event || !event.is_published) return bad("Event not found", 404);

  // Authoritative match — never trust the client's earlier disclosure call.
  const match = await matchEmail(eventId, email);

  if (match.kind === "guest") {
    if (event.strict_checkin) return bad(MESSAGES[lang].blocked, 403);
    if (!inviterName) return bad(MESSAGES[lang].inviter, 400);
  }

  let result;
  try {
    result = await recordCheckin({
      eventId,
      name,
      email,
      language: lang,
      match,
      // inviterName is recorded only for guests; recordCheckin also guards this.
      inviterName: match.kind === "guest" ? inviterName : null,
    });
  } catch (err) {
    console.error("[event-checkin] record failed", { eventId, email, err });
    return bad("Could not record check-in", 500);
  }

  return NextResponse.json({
    ok: true,
    kind: match.kind,
    name,
    checkedInAt: result.checkedInAt,
    already: result.already,
  });
}
