import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Typeahead for the "who invited you?" field on the public check-in page. Scoped
// to THIS event's registrations only (the people who booked tickets) — not the
// global member directory — to limit what an unauthenticated page can enumerate.
// Anyone not in the list is still captured via the free-text inviter name.

const MIN_QUERY = 4;
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

  // Word-prefix match only (a name word that STARTS with the query) — not a
  // loose substring, so "andr" matches "Andrea" but not "Alexandra". Two ilike
  // passes (leading word, or a word after a space) merged and de-duped.
  const escaped = escapeLike(q);
  const baseQuery = () =>
    supabase
      .from("event_registrations")
      .select("id, name")
      .eq("event_id", eventId)
      .in("status", ["paid", "free"])
      .order("name", { ascending: true })
      .limit(MAX_RESULTS);

  const [{ data: byLeading }, { data: byWord }] = await Promise.all([
    baseQuery().ilike("name", `${escaped}%`),
    baseQuery().ilike("name", `% ${escaped}%`),
  ]);

  const seen = new Set<string>();
  const inviters: { registrationId: string; label: string }[] = [];
  for (const r of [...(byLeading ?? []), ...(byWord ?? [])] as {
    id: string;
    name: string;
  }[]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    inviters.push({ registrationId: r.id, label: r.name });
    if (inviters.length >= MAX_RESULTS) break;
  }

  return NextResponse.json({ inviters });
}
