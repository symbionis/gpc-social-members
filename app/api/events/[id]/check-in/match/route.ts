import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchContact } from "@/lib/events/checkin";

// Lightweight advisory lookup that drives progressive disclosure on the check-in
// form: it returns ONLY whether the arrival's contact is on the roster (matched) —
// never names, the echoed contact, or who is on the roster — so an unauthenticated
// caller can't enumerate the roster by probing phones/emails. The authoritative
// check-in is performed on submit. The arrival supplies email and/or phone (E.164).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  let body: { email?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (email && !EMAIL_RE.test(email)) return bad("valid email is required");
  if (!email && !phone) return bad("email or phone is required");

  const supabase = createAdminClient();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, is_published")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();

  if (eventError) {
    console.error("[event-checkin/match] event lookup failed", { eventId, err: eventError });
    return bad("Service temporarily unavailable", 503);
  }
  if (!event || !event.is_published) return bad("Event not found", 404);

  try {
    const match = await matchContact(eventId, {
      email: email || null,
      phone: phone || null,
    });
    return NextResponse.json({ matched: match.kind !== "none" });
  } catch (err) {
    console.error("[event-checkin/match] match failed", { eventId, err });
    return bad("Service temporarily unavailable", 503);
  }
}
