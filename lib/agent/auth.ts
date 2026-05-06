import { timingSafeEqual } from "node:crypto";

export type RequireAgentTokenResult =
  | { ok: true }
  | { ok: false; status: 401 | 503 };

/**
 * Authenticates an agent request via static bearer token.
 *
 * Returns 503 (not 401) when AGENT_API_TOKEN is unset so missing
 * configuration is distinguishable from a wrong token in logs.
 *
 * Comparison is constant-time via crypto.timingSafeEqual after padding both
 * buffers to the same length. The token is server-only — never read from a
 * NEXT_PUBLIC_ var, never returned in responses.
 */
export function requireAgentToken(request: Request): RequireAgentTokenResult {
  const expected = process.env.AGENT_API_TOKEN;
  if (!expected || expected.length === 0) {
    return { ok: false, status: 503 };
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return { ok: false, status: 401 };
  }
  const provided = header.slice("Bearer ".length).trim();
  if (!provided) return { ok: false, status: 401 };

  // Pad both sides to the same length so timingSafeEqual doesn't throw on
  // length mismatch and the comparison stays constant-time even when
  // lengths differ.
  const max = Math.max(expected.length, provided.length);
  const a = Buffer.alloc(max);
  const b = Buffer.alloc(max);
  a.write(expected);
  b.write(provided);

  const equal = timingSafeEqual(a, b) && expected.length === provided.length;
  return equal ? { ok: true } : { ok: false, status: 401 };
}

/**
 * Convenience wrapper for route handlers — returns a NextResponse-shaped
 * error or null when the request is authorized. Lets handlers stay tidy.
 */
export function unauthorizedResponse(status: 401 | 503): Response {
  const body =
    status === 503
      ? { error: "Agent API not configured" }
      : { error: "Unauthorized" };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
