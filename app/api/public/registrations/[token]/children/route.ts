import { NextResponse, type NextRequest } from "next/server";
import { addSelfRegistrationChildren } from "@/lib/events/roster";

// Public, unauthenticated: add name-only children to a party via its self-reg token
// (U13). The adult who just self-registered names the kids attending with them. The
// per-type cap, child-type resolution, and inserts live in the RPC; this route only
// validates the names. The token is taken from the path, never echoed.

const MAX_LEN = 200;
const MAX_CHILDREN = 20; // the party cap bounds it further; this is a sanity ceiling

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return bad("Invalid link", 404);

  let body: { names?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  if (!Array.isArray(body.names)) return bad("names must be provided");
  const names = body.names
    .map((n) => (typeof n === "string" ? n.trim() : ""))
    .filter((n) => n.length > 0);
  if (names.length === 0) return bad("at least one child name is required");
  if (names.length > MAX_CHILDREN) return bad("too many children");
  if (names.some((n) => n.length > MAX_LEN)) return bad("a child name is too long");

  let result;
  try {
    result = await addSelfRegistrationChildren(token, names);
  } catch (err) {
    console.error("[self-reg-children] add failed", { err });
    return bad("Could not add the children", 500);
  }

  switch (result.status) {
    case "ok":
      return NextResponse.json({ ok: true, added: result.added, remaining: result.remaining });
    case "full":
      return NextResponse.json({ ok: false, reason: "full", added: 0 }, { status: 409 });
    case "no_child_tickets":
      return NextResponse.json({ ok: false, reason: "no_child_tickets" }, { status: 409 });
    case "multiple_child_types":
      return NextResponse.json({ ok: false, reason: "multiple_child_types" }, { status: 409 });
    case "inactive":
      return NextResponse.json({ ok: false, reason: "inactive" }, { status: 409 });
    case "invalid":
    default:
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 404 });
  }
}
