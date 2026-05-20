import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchEmail } from "@/lib/events/checkin";

// Lightweight lookup that drives progressive disclosure on the check-in form:
// it returns ONLY whether the email is known (matched) plus the event's strict
// flag — never which table matched — so it can't be used to enumerate who holds
// an active membership. The authoritative kind is re-derived on submit.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email)) return bad("valid email is required");

  const supabase = createAdminClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, is_published, strict_checkin")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();

  if (!event || !event.is_published) return bad("Event not found", 404);

  const match = await matchEmail(eventId, email);

  return NextResponse.json({
    matched: match.kind !== "guest",
    strict: Boolean(event.strict_checkin),
  });
}
