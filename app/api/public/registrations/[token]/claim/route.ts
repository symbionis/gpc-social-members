import { NextResponse, type NextRequest } from "next/server";
import { claimSelfRegistration } from "@/lib/events/roster";
import { WAIVER_VERSION, type WaiverLanguage } from "@/lib/events/waiver";

// Public, unauthenticated guest self-registration claim (U9). A guest follows the
// per-party link (/public/registrations/<token>) and adds themselves to the door
// roster: name + email or phone, optionally signing their own waiver now. The cap
// (party quantity), race-safety, idempotency, and waiver write all live in the
// claim_self_registration RPC; this route only validates input and maps the RPC
// status to HTTP. The token is taken from the path, never echoed back.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = ["fr", "en"] as const;
const MAX_LEN = 200;
const MAX_EMAIL_LEN = 254; // RFC 5321
const MAX_PHONE_LEN = 20; // E.164: max 15 digits + '+'

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
  // Language is only required when actually signing the waiver here.
  if (waiverAccepted && !LANGUAGES.includes(language as WaiverLanguage)) {
    return bad("language must be 'fr' or 'en' to sign the waiver");
  }

  let result;
  try {
    result = await claimSelfRegistration({
      token,
      name,
      email: email || null,
      phone_e164: phone || null,
      language: language || null,
      // Source the version server-side only when the guest signs now, mirroring the
      // door check-in — never trust a client-supplied version.
      waiverVersion: waiverAccepted ? WAIVER_VERSION : null,
      waiverAccepted,
      marketingConsent,
    });
  } catch (err) {
    console.error("[self-reg-claim] claim failed", { err });
    return bad("Could not complete registration", 500);
  }

  switch (result.status) {
    case "claimed":
      return NextResponse.json({
        ok: true,
        name: result.name,
        already: result.already,
        waiverSigned: waiverAccepted,
      });
    case "full":
      return NextResponse.json({ ok: false, reason: "full" }, { status: 409 });
    case "inactive":
      // The link's registration isn't confirmed (e.g. an unpaid checkout).
      return NextResponse.json({ ok: false, reason: "inactive" }, { status: 409 });
    case "invalid_input":
      return bad("Please enter your name and an email or phone number.");
    case "invalid":
    default:
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 404 });
  }
}
