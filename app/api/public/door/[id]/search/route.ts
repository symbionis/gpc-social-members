import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";
import {
  computePartyFills,
  type RosterAttendeeInput,
} from "@/lib/events/roster-fill";

// Public party search for the door console (U4). Keyed on the event id (KTD1):
// the only gate is a published event. Read-only — returns parties matching a
// name/contact query, each with its fill, claimed guests, and self-reg token so
// the console can show the party's QR. Never writes. A short/empty query returns
// no parties (the console prompts staff to type a name) so this isn't a bulk
// roster dump endpoint.

const MIN_QUERY = 2;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type RegRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone_e164: string | null;
  quantity: number | null;
  self_reg_token: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params;

  const event = await resolveDoorEvent(eventId);
  if (!event) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  let body: { query?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }
  const query = typeof body.query === "string" ? body.query.trim().toLowerCase() : "";
  if (query.length < MIN_QUERY) {
    return NextResponse.json({ parties: [] });
  }

  const supabase = createAdminClient();

  const { data: regRows, error: regErr } = await supabase
    .from("event_registrations")
    .select("id, name, email, phone_e164, quantity, self_reg_token")
    .eq("event_id", eventId)
    .in("status", ["paid", "free"]);
  if (regErr) {
    console.error("[door-search] registration lookup failed", { eventId, err: regErr });
    return bad("Service temporarily unavailable", 503);
  }
  const registrations = (regRows ?? []) as RegRow[];

  const { data: attRows, error: attErr } = await supabase
    .from("event_attendees")
    .select(
      "id, registration_id, name, email, phone_e164, is_lead, waiver_accepted_at, checked_in_at"
    )
    .eq("event_id", eventId)
    .eq("slot_status", "claimed");
  if (attErr) {
    console.error("[door-search] attendee lookup failed", { eventId, err: attErr });
    return bad("Service temporarily unavailable", 503);
  }
  const attendees = (attRows ?? []) as RosterAttendeeInput[];

  const fills = computePartyFills(
    registrations.map((r) => ({ id: r.id, quantity: r.quantity ?? 0 })),
    attendees
  );

  const matches = (s: string | null) => !!s && s.toLowerCase().includes(query);

  const parties = registrations
    .map((reg) => {
      const fill = fills.get(reg.id);
      const guests = fill?.guests ?? [];
      const hit =
        matches(reg.name) ||
        matches(reg.email) ||
        matches(reg.phone_e164) ||
        guests.some(
          (g) => matches(g.name) || matches(g.email) || matches(g.phone_e164)
        );
      if (!hit) return null;
      return {
        registrationId: reg.id,
        leadName: reg.name ?? "",
        leadEmail: reg.email ?? "",
        leadPhone: reg.phone_e164 ?? "",
        quantity: fill?.quantity ?? reg.quantity ?? 0,
        claimedCount: fill?.claimedCount ?? 0,
        remaining: fill?.remaining ?? 0,
        complete: fill?.complete ?? false,
        selfRegToken: reg.self_reg_token,
        guests,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ parties });
}
