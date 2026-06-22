// The QR payload for a ticket credential (FEAT-41). Each ticket's bearer credential
// token is rendered as a QR encoding this URL; a future staff scan console (U7)
// resolves the trailing token to its ticket. Kept tiny and shared so the booking
// page, emails, and the console all encode/parse the same shape.
//
// `/c/<token>` — short, so a phone-camera scan opens something resolvable and a
// hardware wedge scanner types a compact string.

export function credentialUrl(token: string, baseUrl?: string): string {
  const base = (baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${base}/c/${token}`;
}

/** Extract a credential token from a scanned value: a full /c/<token> URL or the
 *  bare token. Returns null if nothing token-like is present. */
export function parseCredentialToken(scanned: string): string | null {
  const v = scanned.trim();
  if (!v) return null;
  const m = v.match(/\/c\/([A-Za-z0-9_-]+)\/?$/);
  if (m) return m[1];
  // A bare token (wedge scanner configured to emit just the token).
  if (/^[A-Za-z0-9_-]{16,}$/.test(v)) return v;
  return null;
}
