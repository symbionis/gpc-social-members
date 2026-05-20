import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Typeahead for the "who invited you?" field on the public check-in page. Scoped
// to THIS event's registrations only (the people who booked tickets) — not the
// global member directory — to limit what an unauthenticated page can enumerate.
// Anyone not in the list is still captured via the free-text inviter name.

const MIN_QUERY = 2;
const MAX_RESULTS = 8;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY) return NextResponse.json({ inviters: [] });

  const supabase = createAdminClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, is_published")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();
  if (!event || !event.is_published) return NextResponse.json({ inviters: [] });

  const pattern = `%${escapeLike(q)}%`;
  const { data: regs } = await supabase
    .from("event_registrations")
    .select("id, name")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"])
    .ilike("name", pattern)
    .order("name", { ascending: true })
    .limit(MAX_RESULTS);

  const inviters = (regs ?? []).map((r: { id: string; name: string }) => ({
    registrationId: r.id,
    label: r.name,
  }));

  return NextResponse.json({ inviters });
}
