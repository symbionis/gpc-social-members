import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Rotate a ticket's manage link (U9). Public, authorised by the caller's own per-ticket
// manage_token in the path — the rotate_ticket_manage_token RPC re-validates it, then
// rotates every live same-email household sibling in the registration to a fresh token
// (KTD4), so a leaked link can be revoked for the whole household at once. The old links
// stop resolving immediately (regenerate = revoke, mirroring the admin invite-code route).
//
// Server-generated only — a client-supplied token is never accepted. The new token is
// returned so the caller can move to its new manage URL; sibling holders receive theirs
// on the next grouped delivery (U12).
//
// tickets.manage_token has a single writer: this route + the mint/backfill migration. See
// docs/solutions/architecture-patterns/single-writer-field-ownership-across-routes.md.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("rotate_ticket_manage_token", {
    p_manage_token: token,
  });
  if (error) {
    console.error("[booking-manage-token] rotate failed", { err: error });
    return NextResponse.json({ error: "Could not rotate link" }, { status: 500 });
  }

  const result = (data ?? {}) as { status?: string; manage_token?: string };
  switch (result.status) {
    case "ok":
      return NextResponse.json({ ok: true, manageToken: result.manage_token });
    case "not_found":
    case "invalid":
    default:
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
}
