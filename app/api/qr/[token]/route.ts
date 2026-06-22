import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { credentialUrl } from "@/lib/events/credential";

// Hosted QR image for ticket credentials (FEAT-41 / U9). Emails can't run
// qrcode.react (browser-only) and many clients strip data-URI <img>, so the
// confirmation + forwarding templates reference this URL: <img src="/api/qr/<token>">.
// Renders the SAME payload as the in-app QRs (credentialUrl) so a code scans the same
// whether shown on the booking page or in an email. The token is already a bearer
// secret carried in the email, so no extra auth/lookup is needed — a bad token just
// yields a QR that resolves to "not recognised" at the desk.
export const runtime = "nodejs";

const TOKEN_RE = /^[A-Za-z0-9_-]{8,}$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || !TOKEN_RE.test(token)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let png: Buffer;
  try {
    png = await QRCode.toBuffer(credentialUrl(token), {
      type: "png",
      width: 240,
      margin: 1,
      color: { dark: "#052938", light: "#FFFFFF" },
    });
  } catch (err) {
    // Never cache an error: a cached 500 would render a broken image in every
    // email that references this token for the 24h immutable window.
    console.error("[qr] toBuffer failed", { err });
    return new NextResponse("Could not render QR", {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // Deterministic per token → safe to cache hard.
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
