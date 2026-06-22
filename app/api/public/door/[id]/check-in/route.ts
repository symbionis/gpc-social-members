import { NextResponse, type NextRequest } from "next/server";
import { resolveDoorEvent } from "@/lib/events/door-access";
import { checkInByCredential } from "@/lib/events/checkin";
import { parseCredentialToken } from "@/lib/events/credential";
import { WAIVER_VERSION, type WaiverLanguage } from "@/lib/events/waiver";

// Info-desk scan check-in (U7). Public, keyed on the event id (KTD1 — same open
// posture as the door console). Staff scan a ticket QR; this resolves the credential
// to its exact ticket, scoped to THIS event, and stamps the arrival — filling a
// missing name (one tap) and waiver (one tap) on the spot. A name alone completes a
// check-in (R7); contact is encouraged, not required. The credential is never echoed.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const LANGUAGES = ["fr", "en"] as const;
const MAX_LEN = 200;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  const event = await resolveDoorEvent(eventId);
  if (!event) return bad("Not available", 404);

  let body: {
    token?: unknown;
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

  const token =
    typeof body.token === "string" ? parseCredentialToken(body.token) : null;
  if (!token) return NextResponse.json({ status: "not_recognised" });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const language = typeof body.language === "string" ? body.language : "";
  const waiverAccepted = body.waiverAccepted === true;
  const marketingConsent = body.marketingConsent !== false;

  if (name && name.length > MAX_LEN) return bad("name is too long");
  if (email && !EMAIL_RE.test(email)) return bad("a valid email is required");
  if (phone && !PHONE_RE.test(phone)) return bad("a valid phone is required");
  if (waiverAccepted && !LANGUAGES.includes(language as WaiverLanguage)) {
    return bad("language must be 'fr' or 'en' to sign the waiver");
  }

  try {
    const result = await checkInByCredential({
      eventId,
      credentialToken: token,
      name: name || null,
      email: email || null,
      phone: phone || null,
      language: (language as WaiverLanguage) || null,
      // Source the waiver version server-side only when accepting now — never trust a
      // client-supplied version (mirrors the self-reg claim + kiosk check-in).
      waiverVersion: waiverAccepted ? WAIVER_VERSION : null,
      waiverAccepted,
      marketingConsent,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[door-checkin] checkin_by_credential failed", { eventId, err });
    return bad("Could not check in", 500);
  }
}
