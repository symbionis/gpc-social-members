import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReferenceCode } from "@/lib/events/registration";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import {
  parseLeadInput,
  parseGuestsInput,
  suppliedTicketTypeIds,
  mapCompRpcError,
  mentionsTicketType,
  unresolvedTicketTypeIds,
} from "@/lib/events/guest-list";

// Admin action: create a sponsor's comp guest list — a zero-price registration holding
// one named, credentialled ticket per person — so the (registration-keyed) door console
// picks the party up with no door-side change.
//
// See docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md (U2).
//
// NO SEAT-CAP GATE (KTD6 / R11): the cap is enforced only on the public register route.
// waitlist/convert deliberately omits it so an admin can comp past a full event, and a
// comp list follows the same rule. `seats_used` is returned for DISPLAY only, after the
// write. Nothing is emailed here (R8) — the existing resend-tickets action is the
// delivery path.
//
// Only handlers may be exported from this file; every helper lives in
// lib/events/guest-list.ts (docs/solutions/build-errors/nextjs-app-router-route-file-export-restriction-2026-04-29.md).

const ALLOWED_ROLES = ["super_admin", "team_admin", "events_admin", "finance"];

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Unauthorized", status: 401 as const };

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (!admin || !admin.id || !ALLOWED_ROLES.includes(admin.role)) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { adminClient, adminId: admin.id as string };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { adminClient, adminId } = auth;
  const { id: eventId } = await params;

  let body: { lead?: unknown; guests?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON");
  }

  const lead = parseLeadInput(body.lead);
  if (!lead.ok) return bad(lead.error);

  const guests = parseGuestsInput(body.guests);
  if (!guests.ok) return bad(guests.error);

  const referenceCode = generateReferenceCode();

  // One transaction: registration + CHF 0 line items + the lead's ticket + one named,
  // claimed, is_comp ticket per guest. The RPC resolves every ticket_type_id against
  // THIS event (archived_at IS NULL) and raises if one does not — that is the only
  // thing standing between an unscoped id and a blank ticket-type pill at the door.
  const { data: registrationId, error: rpcErr } = await adminClient.rpc(
    "create_comp_guest_list",
    {
      p_event_id: eventId,
      p_lead: lead.value,
      p_guests: guests.value,
      p_reference_code: referenceCode,
      p_converted_by: adminId,
    }
  );

  if (rpcErr || !registrationId) {
    const mapped = mapCompRpcError(rpcErr ?? {}, "Could not create the guest list");

    // The RPC's refusal is generic ("every ticket_type_id must be an active ticket type
    // of event X"); name the offending type(s) so the admin can fix the right row.
    if (mapped.status === 400 && mentionsTicketType(mapped.message)) {
      const offending = await unresolvedTicketTypeIds(
        adminClient,
        eventId,
        suppliedTicketTypeIds(lead.value, guests.value)
      );
      if (offending.length > 0) {
        return bad(
          `Unknown or archived ticket type for this event: ${offending.join(", ")}`,
          400
        );
      }
    }

    if (mapped.status === 500) {
      console.error("[guest-list] create failed", { eventId, err: rpcErr });
    }
    return bad(mapped.message, mapped.status);
  }

  let seatsUsed: number | null = null;
  try {
    seatsUsed = await getSeatsUsed(adminClient, eventId);
  } catch (err) {
    // Display-only; the list is already written. Log so an RPC regression isn't masked.
    console.error("[guest-list] seat count failed (non-fatal)", { eventId, err });
  }

  return NextResponse.json({
    success: true,
    registration_id: registrationId,
    reference_code: referenceCode,
    seats_used: seatsUsed,
  });
}
