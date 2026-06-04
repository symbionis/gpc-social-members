import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import ManageEventTabs from "@/components/admin/ManageEventTabs";
import { getEventReminderSummary } from "@/lib/events/reminder-summary";
import { validateReminderSchedule } from "@/lib/events/reminder-schedule";
import { rollupTicketItems } from "@/lib/events/tickets";

export default async function ManageEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, start_date, seat_cap, reminder_schedule, visibility, registration_enabled, invite_code"
    )
    .eq("id", id)
    .single();

  if (!event) notFound();

  // Active ticket types — the Settings tab edits per-type guest (invite) prices.
  const { data: rawTicketTypes } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, counts_as_seat")
    .eq("event_id", id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  const ticketTypes = rawTicketTypes ?? [];

  const { data: registrations } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, is_member, quantity, total_amount_chf, status, reference_code, created_at"
    )
    .eq("event_id", id)
    .in("status", ["paid", "free"])
    .order("created_at", { ascending: false });

  // Per-ticket-type breakdown for each party, keyed by registration. The lead row
  // of a party carries the tickets purchased for it; guest rows show none.
  const registrationIds = (registrations ?? []).map((r) => r.id);
  const { data: ticketItemRows } = registrationIds.length
    ? await supabase
        .from("event_registration_items")
        .select("registration_id, title_snapshot, quantity")
        .in("registration_id", registrationIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  const ticketQtyByReg = new Map<string, number>();
  for (const r of registrations ?? []) ticketQtyByReg.set(r.id, r.quantity);

  type TicketItemRow = {
    registration_id: string;
    title_snapshot: string | null;
    quantity: number | null;
  };
  const ticketItemsByReg = new Map<string, TicketItemRow[]>();
  for (const item of (ticketItemRows ?? []) as TicketItemRow[]) {
    const list = ticketItemsByReg.get(item.registration_id) ?? [];
    list.push(item);
    ticketItemsByReg.set(item.registration_id, list);
  }

  // event_attendees is the per-person source of truth for identity, waiver, and
  // arrival (event_checkins is frozen). The roster is flat — one row per person,
  // claimed slots only (unclaimed Milestone-2 placeholders have no identity yet).
  const { data: attendeeRows } = await supabase
    .from("event_attendees")
    .select(
      "id, registration_id, member_id, name, email, phone_e164, is_lead, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", id)
    .eq("slot_status", "claimed")
    .order("created_at", { ascending: true });

  type AttendeeRow = {
    id: string;
    registration_id: string | null;
    member_id: string | null;
    name: string | null;
    email: string | null;
    phone_e164: string | null;
    is_lead: boolean;
    waiver_accepted_at: string | null;
    checked_in_at: string | null;
    created_at: string;
  };
  const roster = (attendeeRows ?? []) as AttendeeRow[];

  // Lead name per registration → guests can be attributed to their party's lead.
  const leadNameByReg = new Map<string, string>();
  for (const a of roster) {
    if (a.is_lead && a.registration_id && a.name) {
      leadNameByReg.set(a.registration_id, a.name);
    }
  }

  const attendees = roster.map((a) => {
    // Tickets are attributed to the party's lead row only (the guests share them).
    const ticketRegId = a.is_lead ? a.registration_id : null;
    return {
      id: a.id,
      name: a.name ?? "",
      email: a.email ?? "",
      phone_e164: a.phone_e164 ?? "",
      isMember: a.member_id !== null,
      isLead: a.is_lead,
      // The lead's name for this party, when the attendee belongs to a registration
      // and isn't themselves the lead. Empty otherwise (lead row or no party).
      leadName:
        !a.is_lead && a.registration_id
          ? leadNameByReg.get(a.registration_id) ?? ""
          : "",
      ticketCount: ticketRegId ? ticketQtyByReg.get(ticketRegId) ?? null : null,
      ticketBreakdown: ticketRegId
        ? rollupTicketItems(ticketItemsByReg.get(ticketRegId) ?? [])
        : [],
      waiverSigned: a.waiver_accepted_at !== null,
      checkedIn: a.checked_in_at !== null,
      arrivedAt: a.checked_in_at,
      createdAt: a.created_at,
    };
  });

  const checkedInCount = attendees.filter((a) => a.checkedIn).length;

  const total = (registrations ?? []).reduce((acc, a) => acc + a.quantity, 0);
  const seatCap = event.seat_cap as number | null;
  const hasSeatCap = seatCap !== null && seatCap !== undefined;
  const overbooked = hasSeatCap && total > seatCap;

  const { data: waitlist } = hasSeatCap
    ? await supabase
        .from("event_waitlist")
        .select("id, name, email, created_at")
        .eq("event_id", id)
        .order("created_at", { ascending: true })
    : { data: [] };

  // Per-event extra reminder schedule, edited from the Messaging tab.
  const reminderSchedule =
    validateReminderSchedule(event.reminder_schedule).value ?? [];

  // Event comms log: reminders already sent + ad-hoc messages sent from this tab.
  const reminders = await getEventReminderSummary(id);
  const { data: sentMessages } = await supabase
    .from("broadcasts")
    .select("id, subject, body_html, kind, recipient_count, error_count, status, sent_at, created_at")
    .eq("event_id", id)
    .order("created_at", { ascending: false });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const checkInPath = `/public/events/${id}/check-in`;

  return (
    <div>
      <Link
        href="/admin/events"
        className="inline-flex items-center gap-1 text-sm font-body text-muted-foreground hover:text-marine transition-colors mb-4"
      >
        ← Back to Events
      </Link>

      <div className="mb-6">
        <p className="font-accent text-xs tracking-[0.3em] uppercase text-sky-dark mb-1">
          Manage Event
        </p>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine">
          {event.title}
        </h1>
      </div>

      <ManageEventTabs
        eventId={id}
        attendees={attendees}
        checkedInCount={checkedInCount}
        waitlist={waitlist ?? []}
        hasSeatCap={hasSeatCap}
        total={total}
        seatCap={seatCap}
        overbooked={overbooked}
        csvHref={`/api/admin/events/${id}/attendees?format=csv`}
        baseUrl={baseUrl}
        checkInPath={checkInPath}
        reminders={reminders}
        sentMessages={sentMessages ?? []}
        reminderSchedule={reminderSchedule}
        visibility={(event.visibility as string) ?? "members_only"}
        inviteCode={(event.invite_code as string | null) ?? null}
        ticketTypes={ticketTypes}
        registrationEnabled={Boolean(event.registration_enabled)}
      />
    </div>
  );
}
