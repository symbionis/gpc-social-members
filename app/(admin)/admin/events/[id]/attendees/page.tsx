import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import ManageEventTabs from "@/components/admin/ManageEventTabs";
import { getEventReminderSummary } from "@/lib/events/reminder-summary";
import { validateReminderSchedule } from "@/lib/events/reminder-schedule";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { ticketRefundValueChf, type RefundRegistration } from "@/lib/events/refunds";
import { mergePaymentIntentIds } from "@/lib/events/refund-pool";
import type { CancellationRow } from "@/components/admin/CancellationsPanel";
import { stripeTestModeFromKey } from "@/lib/stripe/dashboard";

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
    .select("id, title, price_member, price_non_member, invite_price, counts_as_seat")
    .eq("event_id", id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  if (ticketTypesError) failLoad("ticket types", ticketTypesError);
  const ticketTypes = rawTicketTypes ?? [];

  const { data: registrations, error: registrationsError } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, is_member, quantity, total_amount_chf, status, reference_code, manage_token, ticket_email_sent_at, stripe_payment_intent_id, is_guest_list, created_at"
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
        // `unit_amount_chf` is the price snapshotted at checkout — the roster shows it on the
        // refund button so the admin sees what will leave the account before clicking.
        .select("registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf")
        .in("registration_id", registrationIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (ticketItemRowsError) failLoad("ticket items", ticketItemRowsError);

  type TicketItemRow = {
    registration_id: string;
    ticket_type_id: string | null;
    title_snapshot: string | null;
    quantity: number | null;
    unit_amount_chf: number | string | null;
  };

  // Every ticket SOLD for the event — `issued` (nobody named yet) and `claimed` (named)
  // alike (R25), so the on-screen roster length matches tickets sold rather than only its
  // named subset. `manage_token` and `qr_email_sent_at` feed the per-address manage link
  // and the per-address "notified" indicator (U15).
  const { data: attendeeRows, error: attendeeRowsError } = await supabase
    .from("tickets")
    .select(
      "id, registration_id, member_id, name, email, phone_e164, is_lead, slot_status, ticket_type_id, is_comp, manage_token, qr_email_sent_at, cancellation_status, cancellation_requested_at, cancellation_refunded_at, refund_amount_chf, stripe_refund_id, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", id)
    .in("slot_status", ["issued", "claimed"])
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
    slot_status: string;
    ticket_type_id: string | null;
    is_comp: boolean;
    manage_token: string | null;
    qr_email_sent_at: string | null;
    cancellation_status: string | null;
    cancellation_requested_at: string | null;
    cancellation_refunded_at: string | null;
    refund_amount_chf: number | string | null;
    stripe_refund_id: string | null;
    waiver_accepted_at: string | null;
    checked_in_at: string | null;
    created_at: string;
  };
  const roster = (attendeeRows ?? []) as AttendeeRow[];
  // The named subset. The comp guest lists reason about claimed people only, so they read
  // this — never the widened roster, which also carries unnamed `issued` rows that would
  // inflate their counts.
  const claimedRoster = roster.filter((a) => a.slot_status === "claimed");

  // Resolve each person's ticket-type id to a title (asado meal). Built from the
  // event's active types loaded above; an attendee holding an archived type just
  // shows no label.
  const ticketTitleById = new Map<string, string>();
  for (const tt of ticketTypes) {
    ticketTitleById.set(tt.id as string, (tt.title as string | null) ?? "");
  }


  const refByReg = new Map<string, string | null>();
  // Whether the buyer's confirmation email (carrying the buyer's own QR) has gone out, per
  // registration. The lead ticket rides that email rather than the grouped household email,
  // so its "notified" state lives here, not on the ticket's qr_email_sent_at.
  const ticketEmailSentAtByReg = new Map<string, string | null>();
  // The booking fields the per-seat refund value is derived from, via the same helper the refund
  // route uses — so the figure shown on the Refunds tab is the one the route will compute. What
  // actually reaches Stripe is confirmed by the route against the booking's live charges, and
  // the response reports it back rather than the UI assuming.
  const regForRefundById = new Map<string, RefundRegistration>();
  for (const r of registrations ?? []) {
    refByReg.set(r.id, (r.reference_code as string | null) ?? null);
    regForRefundById.set(r.id, {
      id: r.id,
      status: (r.status as string | null) ?? null,
      quantity: (r.quantity as number | null) ?? null,
      total_amount_chf: (r.total_amount_chf as number | string | null) ?? null,
    });
    ticketEmailSentAtByReg.set(
      r.id,
      (r as { ticket_email_sent_at?: string | null }).ticket_email_sent_at ?? null
    );
  }

  // Live seats only. A cancelled seat is money work, handled in the Refunds tab; showing it
  // here padded a door document with rows nobody can admit. `claimedRoster` above is
  // deliberately NOT filtered — the guest-list tab reasons about every claimed seat,
  // cancelled or not.
  const attendees = roster
    .filter((a) => a.cancellation_status === null)
    .map((a) => {
    const named = a.slot_status === "claimed";
    // "Notified" is per person: a guest's QR rides the grouped household email
    // (ticket.qr_email_sent_at); the buyer's own rides the booking confirmation
    // (registration.ticket_email_sent_at). A per-address resend stamps qr_email_sent_at on
    // the lead too, so check both for a lead. An unnamed ticket has no QR to have sent.
    const regNotified =
      a.registration_id ? ticketEmailSentAtByReg.get(a.registration_id) ?? null : null;
    const notified = !named
      ? false
      : a.qr_email_sent_at !== null || (a.is_lead && regNotified !== null);
    return {
      id: a.id,
      registrationId: a.registration_id,
      referenceCode: a.registration_id ? refByReg.get(a.registration_id) ?? null : null,
      name: a.name ?? "",
      email: a.email ?? "",
      phone_e164: a.phone_e164 ?? "",
      isMember: a.member_id !== null,
      isLead: a.is_lead,
      // This ticket's own type title (asado meal); "" when none.
      ticketTypeTitle: a.ticket_type_id
        ? ticketTitleById.get(a.ticket_type_id) ?? ""
        : "",
      // This ticket's OWN manage_token (U9) → the household manage page; any ticket at an
      // address resolves the whole household, so the card links to whichever it has.
      manageToken: a.manage_token,
      notified,
      waiverSigned: a.waiver_accepted_at !== null,
      checkedIn: a.checked_in_at !== null,
      arrivedAt: a.checked_in_at,
      createdAt: a.created_at,
      // A comped seat on a sponsor's guest list. Drives the Comp pill; the Guest list tab is
      // where such a seat is removed (remove_comp_guest), which shrinks the party rather than
      // reopening the seat publicly.
      isComp: Boolean(a.is_comp),
      // A comped seat first (a sponsor gave it away even on a paid booking), then the
      // booking's own status. `free` covers a free event and an admin-comped conversion alike:
      // both took no money, which is what the pill is answering.
      paymentState: a.is_comp
        ? ("comp" as const)
        : (regForRefundById.get(a.registration_id ?? "")?.status ?? "paid") === "free"
          ? ("free" as const)
          : ("paid" as const),
      named,
    };
  });

  const checkedInCount = attendees.filter((a) => a.checkedIn).length;

  // ---------------------------------------------------------------------------
  // Refunds tab: the cancelled seats, with the charges their money would come back from.
  //
  // A booking can hold several charges — the original checkout plus one per applied top-up and
  // priced conversion — and only the first is on the registration row. The refund route draws
  // from all of them, so the tab shows all of them: an admin about to move money should be able
  // to see where it comes from. Read only when there is a cancellation to explain.
  // ---------------------------------------------------------------------------
  const cancelledTickets = roster.filter((t) => t.cancellation_status !== null);
  const cancelledRegIds = [
    ...new Set(cancelledTickets.map((t) => t.registration_id).filter((id): id is string => !!id)),
  ];

  const [topupRows, conversionRows] = cancelledRegIds.length
    ? await Promise.all([
        supabase
          .from("event_registration_topups")
          .select("registration_id, stripe_payment_intent_id")
          .in("registration_id", cancelledRegIds)
          .not("applied_at", "is", null),
        supabase
          .from("event_ticket_type_conversions")
          .select("registration_id, stripe_payment_intent_id")
          .in("registration_id", cancelledRegIds)
          .not("applied_at", "is", null),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (topupRows.error) failLoad("top-up payments", topupRows.error);
  if (conversionRows.error) failLoad("conversion payments", conversionRows.error);

  const extraPisByReg = new Map<string, (string | null)[]>();
  for (const row of [...(topupRows.data ?? []), ...(conversionRows.data ?? [])]) {
    const regId = row.registration_id as string;
    const list = extraPisByReg.get(regId) ?? [];
    list.push((row as { stripe_payment_intent_id?: string | null }).stripe_payment_intent_id ?? null);
    extraPisByReg.set(regId, list);
  }

  const regByIdForRefunds = new Map(
    (registrations ?? []).map((r) => [r.id as string, r])
  );

  const cancellations: CancellationRow[] = cancelledTickets
    .map((t) => {
      const reg = t.registration_id ? regByIdForRefunds.get(t.registration_id) : undefined;
      const recorded = t.refund_amount_chf;
      return {
        ticketId: t.id,
        name: t.name ?? "",
        email: t.email ?? "",
        ticketTypeTitle: t.ticket_type_id ? ticketTitleById.get(t.ticket_type_id) ?? "" : "",
        referenceCode: (reg?.reference_code as string | null) ?? null,
        payerName: (reg?.name as string | null) ?? "",
        payerEmail: (reg?.email as string | null) ?? "",
        requestedAt: t.cancellation_requested_at,
        status: t.cancellation_status === "refunded" ? ("refunded" as const) : ("requested" as const),
        refundValueChf: t.registration_id
          ? ticketRefundValueChf(
              t,
              regForRefundById.get(t.registration_id) ?? null,
              (ticketItemRows ?? []) as TicketItemRow[]
            )
          : 0,
        refundedChf: recorded === null || recorded === undefined ? null : Number(recorded),
        refundedAt: t.cancellation_refunded_at,
        stripeRefundId: t.stripe_refund_id,
        paymentIntentIds: mergePaymentIntentIds(
          (reg?.stripe_payment_intent_id as string | null) ?? null,
          t.registration_id ? extraPisByReg.get(t.registration_id) ?? [] : []
        ),
      };
    })
    // Oldest cancellation first: the queue is worked front to back.
    .sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? ""));

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
      sold: soldByTicketType.get(typeId) ?? 0,
    };
  });

  // The event's comp guest lists (is_guest_list registrations) with their tickets — the
  // Guest list tab maintains these. Both halves are already in hand: `registrations`
  // holds every paid/free registration of this event, and `claimedRoster` holds every
  // claimed, non-released ticket of it. Every comp-guest ticket is claimed (a comp seat is
  // minted named), so the named subset already contains them — no second round trip, and
  // tombstoned tickets are excluded by the roster query's released_at filter.
  const rosterByReg = new Map<string, AttendeeRow[]>();
  for (const a of claimedRoster) {
    if (!a.registration_id) continue;
    const list = rosterByReg.get(a.registration_id) ?? [];
    list.push(a);
    rosterByReg.set(a.registration_id, list);
  }

  const guestLists = (registrations ?? [])
    .filter((r) => r.is_guest_list === true)
    .map((r) => ({
      registrationId: r.id,
      referenceCode: (r.reference_code as string | null) ?? null,
      leadName: (r.name as string | null) ?? "",
      leadEmail: (r.email as string | null) ?? "",
      people: (rosterByReg.get(r.id) ?? [])
        // COMP tickets only. A comp registration carries a manage_token and the public
        // top-up route accepts status 'free', so the sponsor lead can buy REAL paid tickets
        // onto this very registration. Those claimed rows are is_comp = false, and listing
        // them here would offer the guest-list Remove on a ticket the customer paid for (the
        // DELETE route refuses them anyway — this is what keeps it from ever appearing).
        .filter((t) => t.is_comp)
        // Lead first, then the guests in the order they were added.
        .slice()
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

  // Seats SOLD across every paid/free booking — what was bought, cancellations included.
  const sold = (registrations ?? []).reduce((acc, a) => acc + a.quantity, 0);
  // Seats still standing. `seats_used` is the authoritative figure: it subtracts cancelled
  // seat-counting tickets and is the same number that gates public registration. Deriving the
  // cap warning from `sold` told an admin an event was overbooked while registration was still
  // open — 23 of 17 on screen against a real 16 of 17.
  let liveSeats = sold;
  try {
    liveSeats = await getSeatsUsed(supabase, id);
  } catch (err) {
    // Fall back to the sold count rather than failing the page. It over-states, so the cap
    // warning errs toward caution.
    console.error("[admin/events/attendees] seat usage failed", { id, err });
  }
  const cancelledSeats = Math.max(0, sold - liveSeats);
  const seatCap = event.seat_cap as number | null;
  const hasSeatCap = seatCap !== null && seatCap !== undefined;
  const overbooked = hasSeatCap && liveSeats > seatCap;

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
  // Point the admin cancellation view's Stripe refund links at the matching dashboard mode.
  // Derived from the LIVE marker, so a missing key falls back to test mode rather
  // than surfacing production refund links from a staging deploy.
  const stripeTestMode = stripeTestModeFromKey(process.env.STRIPE_SECRET_KEY);

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
        cancellations={cancellations}
        stripeTestMode={stripeTestMode}
        checkedInCount={checkedInCount}
        ticketTypeSummary={ticketTypeSummary}
        waitlist={waitlist ?? []}
        hasSeatCap={hasSeatCap}
        total={liveSeats}
        sold={sold}
        cancelledSeats={cancelledSeats}
        seatCap={seatCap}
        overbooked={overbooked}
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
