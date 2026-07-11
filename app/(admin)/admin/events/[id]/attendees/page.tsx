import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import ManageEventTabs from "@/components/admin/ManageEventTabs";
import { getEventReminderSummary } from "@/lib/events/reminder-summary";
import { validateReminderSchedule } from "@/lib/events/reminder-schedule";
import { rollupTicketItems } from "@/lib/events/tickets";
import { computePartyFills, rosterGuestSummary } from "@/lib/events/roster-fill";

export default async function ManageEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  // A failed query must surface as an error, not silently render as an empty
  // roster of zeros (indistinguishable from a genuinely empty event).
  const failLoad = (scope: string, error: unknown): never => {
    console.error("[admin/events/attendees] load failed", { id, scope, err: error });
    const detail = error && typeof error === "object" && "message" in error
      ? (error as { message: string }).message
      : String(error);
    throw new Error(`Could not load ${scope}: ${detail}`, { cause: error });
  };

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, start_date, seat_cap, reminder_schedule, visibility, registration_enabled, invite_code"
    )
    .eq("id", id)
    .single();

  if (!event) notFound();

  // Active ticket types — the Settings tab edits per-type guest (invite) prices.
  const { data: rawTicketTypes, error: ticketTypesError } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, counts_as_seat, is_child")
    .eq("event_id", id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  if (ticketTypesError) failLoad("ticket types", ticketTypesError);
  const ticketTypes = rawTicketTypes ?? [];

  const { data: registrations, error: registrationsError } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, is_member, quantity, total_amount_chf, status, reference_code, self_reg_token, manage_token, ticket_email_sent_at, created_at"
    )
    .eq("event_id", id)
    .in("status", ["paid", "free"])
    .order("created_at", { ascending: false });
  if (registrationsError) failLoad("registrations", registrationsError);

  // Per-ticket-type breakdown for each party, keyed by registration. The lead row
  // of a party carries the tickets purchased for it; guest rows show none.
  const registrationIds = (registrations ?? []).map((r) => r.id);
  const { data: ticketItemRows, error: ticketItemRowsError } = registrationIds.length
    ? await supabase
        .from("event_registration_items")
        .select("registration_id, ticket_type_id, title_snapshot, quantity")
        .in("registration_id", registrationIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (ticketItemRowsError) failLoad("ticket items", ticketItemRowsError);

  const ticketQtyByReg = new Map<string, number>();
  for (const r of registrations ?? []) ticketQtyByReg.set(r.id, r.quantity);

  type TicketItemRow = {
    registration_id: string;
    ticket_type_id: string | null;
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
  const { data: attendeeRows, error: attendeeRowsError } = await supabase
    .from("tickets")
    .select(
      "id, registration_id, member_id, name, email, phone_e164, is_lead, ticket_type_id, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", id)
    .eq("slot_status", "claimed")
    .is("released_at", null)
    .order("created_at", { ascending: true });
  if (attendeeRowsError) failLoad("attendees", attendeeRowsError);

  type AttendeeRow = {
    id: string;
    registration_id: string | null;
    member_id: string | null;
    name: string | null;
    email: string | null;
    phone_e164: string | null;
    is_lead: boolean;
    ticket_type_id: string | null;
    waiver_accepted_at: string | null;
    checked_in_at: string | null;
    created_at: string;
  };
  const roster = (attendeeRows ?? []) as AttendeeRow[];

  // Resolve each person's ticket-type id to a title (asado meal). Built from the
  // event's active types loaded above; an attendee holding an archived type just
  // shows no label.
  const ticketTitleById = new Map<string, string>();
  for (const tt of ticketTypes) {
    ticketTitleById.set(tt.id as string, (tt.title as string | null) ?? "");
  }

  // Lead name per registration, from the party's lead attendee row → guests show
  // "Guest of <lead>". Each booking has a real lead (the first-listed person when
  // the purchaser booked on behalf of a group), so this always resolves.
  const leadNameByReg = new Map<string, string>();
  for (const a of roster) {
    if (a.is_lead && a.registration_id && a.name) {
      leadNameByReg.set(a.registration_id, a.name);
    }
  }

  // Per-party self-registration fill (claimed of purchased + the claimed guests),
  // attached to each lead row so it can expand into a party drawer. Fill is derived
  // (quantity − claimed count); approach B has no placeholder rows.
  const regsForFill = (registrations ?? []).map((r) => ({
    id: r.id as string,
    quantity: (r.quantity as number) ?? 0,
  }));
  const partyFills = computePartyFills(regsForFill, roster);
  const guestSummary = rosterGuestSummary(regsForFill, roster);
  const selfRegTokenByReg = new Map<string, string | null>();
  // Per-booking manage_token → the lead's "My Booking" page link, surfaced on the
  // admin roster so staff can open/manage a party exactly as the lead sees it.
  const manageTokenByReg = new Map<string, string | null>();
  const refByReg = new Map<string, string | null>();
  // When the ticket/booking email was last sent for each registration (null = never
  // sent → "not yet notified", drives the lead-row resend indicator + bulk count).
  const ticketEmailSentAtByReg = new Map<string, string | null>();
  for (const r of registrations ?? []) {
    selfRegTokenByReg.set(
      r.id,
      (r as { self_reg_token?: string | null }).self_reg_token ?? null
    );
    manageTokenByReg.set(
      r.id,
      (r as { manage_token?: string | null }).manage_token ?? null
    );
    refByReg.set(r.id, (r.reference_code as string | null) ?? null);
    ticketEmailSentAtByReg.set(
      r.id,
      (r as { ticket_email_sent_at?: string | null }).ticket_email_sent_at ?? null
    );
  }

  const attendees = roster.map((a) => {
    // Tickets and party fill are attributed to the party's lead row only (the
    // guests share them).
    const ticketRegId = a.is_lead ? a.registration_id : null;
    const fill = ticketRegId ? partyFills.get(ticketRegId) ?? null : null;
    return {
      id: a.id,
      registrationId: a.registration_id,
      referenceCode: a.registration_id ? refByReg.get(a.registration_id) ?? null : null,
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
      // The individual's ticket type (asado meal) — shown on guest rows; lead rows
      // show the whole party's breakdown instead.
      ticketTypeTitle: a.ticket_type_id
        ? ticketTitleById.get(a.ticket_type_id) ?? ""
        : "",
      // Party self-reg detail for the expandable lead drawer (null on guest rows).
      party:
        fill && ticketRegId
          ? { ...fill, selfRegToken: selfRegTokenByReg.get(ticketRegId) ?? null }
          : null,
      // The lead's "My Booking" manage_token → booking-page link on lead rows (guests
      // share the lead's booking, so it's attributed to the lead only).
      manageToken: ticketRegId ? manageTokenByReg.get(ticketRegId) ?? null : null,
      // When this party's ticket email was last sent — lead rows only (guests share
      // the lead's booking). null = never sent → "not yet notified".
      ticketEmailSentAt: ticketRegId
        ? ticketEmailSentAtByReg.get(ticketRegId) ?? null
        : null,
      waiverSigned: a.waiver_accepted_at !== null,
      checkedIn: a.checked_in_at !== null,
      arrivedAt: a.checked_in_at,
      createdAt: a.created_at,
    };
  });

  const checkedInCount = attendees.filter((a) => a.checkedIn).length;

  // Per-ticket-type breakdown for the roster header. `sold` is the tickets
  // purchased of each type (event_registration_items.quantity by ticket_type_id).
  // Older events created before per-type tracking have no ticket_type_id on their
  // items, so `sold` stays 0 for them.
  const soldByTicketType = new Map<string, number>();
  for (const item of (ticketItemRows ?? []) as TicketItemRow[]) {
    if (!item.ticket_type_id) continue;
    soldByTicketType.set(
      item.ticket_type_id,
      (soldByTicketType.get(item.ticket_type_id) ?? 0) + (item.quantity ?? 0)
    );
  }
  const ticketTypeSummary = ticketTypes.map((tt) => {
    const typeId = tt.id as string;
    return {
      id: typeId,
      title: (tt.title as string | null) ?? "",
      priceMember: (tt.price_member as number | null) ?? null,
      priceNonMember: (tt.price_non_member as number | null) ?? null,
      countsAsSeat: Boolean(tt.counts_as_seat),
      isChild: Boolean(tt.is_child),
      sold: soldByTicketType.get(typeId) ?? 0,
    };
  });

  // The event's comp guest lists (is_guest_list registrations) with their tickets — the
  // Guest list tab maintains these. Tombstoned tickets are excluded; unnamed `issued`
  // slots cannot occur on a comp list (every seat is minted named), so no slot filter is
  // needed beyond that.
  const { data: guestListRows, error: guestListError } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, reference_code, created_at, tickets(id, name, email, is_lead, ticket_type_id, checked_in_at, released_at, created_at)"
    )
    .eq("event_id", id)
    .eq("is_guest_list", true)
    .in("status", ["paid", "free"])
    .order("created_at", { ascending: false });
  if (guestListError) failLoad("guest lists", guestListError);

  const guestLists = (guestListRows ?? []).map((r) => ({
    registrationId: r.id,
    referenceCode: (r.reference_code as string | null) ?? null,
    leadName: (r.name as string | null) ?? "",
    leadEmail: (r.email as string | null) ?? "",
    people: (r.tickets ?? [])
      .filter((t) => t.released_at === null)
      // Lead first, then the guests in the order they were added.
      .sort((a, b) =>
        a.is_lead === b.is_lead
          ? a.created_at.localeCompare(b.created_at)
          : a.is_lead
            ? -1
            : 1
      )
      .map((t) => ({
        ticketId: t.id,
        name: t.name ?? "",
        email: t.email ?? null,
        ticketTypeTitle: t.ticket_type_id ? ticketTitleById.get(t.ticket_type_id) ?? "" : "",
        isLead: t.is_lead,
        checkedIn: t.checked_in_at !== null,
      })),
  }));

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
        guestsRegistered={guestSummary.registered}
        ticketTypeSummary={ticketTypeSummary}
        waitlist={waitlist ?? []}
        hasSeatCap={hasSeatCap}
        total={total}
        seatCap={seatCap}
        overbooked={overbooked}
        csvHref={`/api/admin/events/${id}/attendees?format=csv`}
        baseUrl={baseUrl}
        reminders={reminders}
        sentMessages={sentMessages ?? []}
        reminderSchedule={reminderSchedule}
        visibility={(event.visibility as string) ?? "members_only"}
        inviteCode={(event.invite_code as string | null) ?? null}
        ticketTypes={ticketTypes}
        registrationEnabled={Boolean(event.registration_enabled)}
        guestLists={guestLists}
      />
    </div>
  );
}
