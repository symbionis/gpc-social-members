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
import {
  deriveWaitlistOfferability,
  isWaitlistEntryRedeemed,
  emailAlreadyRegistered,
} from "@/lib/events/waitlist-offer";
import {
  ADMISSIBLE_SLOT_STATUSES,
  partitionByCancellation,
} from "@/lib/events/ticket-admissibility";
import { splitBookedTickets } from "@/lib/events/booked-tickets";
import { fetchGuestLists } from "@/lib/events/guest-lists";

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
      "id, title, start_date, seat_cap, reminder_schedule, visibility, registration_enabled, invite_code, max_tickets_invite"
    )
    .eq("id", id)
    .single();

  if (!event) notFound();

  // Every ticket type for the event, archived included — the waitlist offerability check
  // (U2) needs to show the requested type's title even when it has since been archived,
  // per R14's "no silent fallback" rule: a flagged row must name the type it asked for,
  // not hide it. `ticketTypes` (active, sort_order) is a filtered/sorted view of the same
  // result rather than a second round trip to the same table.
  const { data: rawAllTicketTypes, error: ticketTypesError } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, counts_as_seat, archived_at, sort_order")
    .eq("event_id", id)
    .order("sort_order", { ascending: true });
  if (ticketTypesError) failLoad("ticket types", ticketTypesError);
  const allTicketTypes = rawAllTicketTypes ?? [];
  const ticketTypes = allTicketTypes.filter((tt) => tt.archived_at === null);
  const ticketTypeById = new Map(allTicketTypes.map((tt) => [tt.id as string, tt]));

  // Paged explicitly. Supabase returns at most 1000 rows and reports NO error when it
  // truncates, so a single unbounded select would quietly drop attendees past the
  // thousandth on a large event — and, because this same set derives waitlist
  // redemption below, would also make a redeemed entry read as still-offerable.
  // Same rule as lib/events/seat-usage.ts: never count or match off a truncated read.
  const REG_PAGE = 1000;
  const fetchRegistrationsPage = (page: number) =>
    supabase
      .from("event_registrations")
      .select(
        "id, name, email, is_member, quantity, total_amount_chf, status, reference_code, manage_token, ticket_email_sent_at, stripe_payment_intent_id, is_guest_list, created_at, waitlist_entry_id"
      )
      .eq("event_id", id)
      .in("status", ["paid", "free"])
      // `id` breaks ties: a paged read on a non-unique sort key can repeat or drop rows
      // between pages (same rule lib/events/door-access.ts follows).
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * REG_PAGE, page * REG_PAGE + REG_PAGE - 1);

  type RegistrationRow = NonNullable<
    Awaited<ReturnType<typeof fetchRegistrationsPage>>["data"]
  >[number];

  const registrations: RegistrationRow[] = [];
  for (let page = 0; ; page++) {
    const { data: pageRows, error: registrationsError } =
      await fetchRegistrationsPage(page);
    if (registrationsError) failLoad("registrations", registrationsError);
    registrations.push(...(pageRows ?? []));
    if (!pageRows || pageRows.length < REG_PAGE) break;
  }

  // Per-ticket-type breakdown for each party, keyed by registration. The lead row
  // of a party carries the tickets purchased for it; guest rows show none.
  const registrationIds = (registrations ?? []).map((r) => r.id);
  // Paged for the same reason the registrations read above is: this set now feeds the booked
  // ticket split, and a silently truncated read would under-count it — which the overview
  // then displays as cancellations that never happened.
  const fetchItemsPage = (page: number) =>
    supabase
      .from("event_registration_items")
      // `unit_amount_chf` is the price snapshotted at checkout — the roster shows it on the
      // refund button so the admin sees what will leave the account before clicking.
      .select("registration_id, ticket_type_id, title_snapshot, quantity, unit_amount_chf")
      .in("registration_id", registrationIds)
      .order("id", { ascending: true })
      .range(page * REG_PAGE, page * REG_PAGE + REG_PAGE - 1);

  type ItemRow = NonNullable<Awaited<ReturnType<typeof fetchItemsPage>>["data"]>[number];
  const ticketItemRows: ItemRow[] = [];
  if (registrationIds.length) {
    for (let page = 0; ; page++) {
      const { data: pageRows, error: ticketItemRowsError } = await fetchItemsPage(page);
      if (ticketItemRowsError) failLoad("ticket items", ticketItemRowsError);
      ticketItemRows.push(...(pageRows ?? []));
      if (!pageRows || pageRows.length < REG_PAGE) break;
    }
  }

  type TicketItemRow = {
    registration_id: string;
    ticket_type_id: string | null;
    title_snapshot: string | null;
    quantity: number | null;
    unit_amount_chf: number | string | null;
  };

  // Every ticket BOOKED for the event — `issued` (nobody named yet) and `claimed` (named)
  // alike (R25), so the on-screen roster length matches tickets booked rather than only its
  // named subset. ("Sold" is reserved for money taken; comps and free bookings are in here.) `manage_token` and `qr_email_sent_at` feed the per-address manage link
  // and the per-address "notified" indicator (U15).
  const { data: attendeeRows, error: attendeeRowsError } = await supabase
    .from("tickets")
    .select(
      "id, registration_id, member_id, name, email, phone_e164, is_lead, slot_status, ticket_type_id, manage_token, qr_email_sent_at, cancellation_status, cancellation_requested_at, cancellation_refunded_at, refund_amount_chf, stripe_refund_id, waiver_accepted_at, checked_in_at, created_at"
    )
    .eq("event_id", id)
    .in("slot_status", [...ADMISSIBLE_SLOT_STATUSES])
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
  const attendees = partitionByCancellation(roster).live.map((a) => {
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
      // What this seat cost, shown under its ticket type. The SAME valuation the refund button
      // uses (lib/events/refunds.ts), deliberately: the roster and the refund must never quote
      // different prices for one seat. Returns 0 for any ticket on a `free` booking — which
      // covers a historical comp, since a sponsor guest-list registration is itself `free` — and
      // falls back to the booking average when a repriced top-up makes the seat's own line
      // ambiguous — so this is what the seat is WORTH, not a lookup of the type's current list
      // price, which may have changed since checkout.
      priceChf: a.registration_id
        ? ticketRefundValueChf(
            a,
            regForRefundById.get(a.registration_id) ?? null,
            (ticketItemRows ?? []) as TicketItemRow[]
          )
        : 0,
      // `free` covers a free event, an admin-comped conversion, and a historical sponsor
      // guest-list seat alike (comp is retired, R16/KD7) — all three took no money, which is
      // what the pill is answering, and none of them earns a special branch of its own anymore.
      paymentState:
        (regForRefundById.get(a.registration_id ?? "")?.status ?? "paid") === "free"
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

  // The event's guest lists, U5 model (event_guest_lists + tickets.guest_list_id, KD10): a
  // guest on a list IS a ticket with no registration behind it, so this reads
  // lib/events/guest-lists.ts rather than anything off `registrations`/`claimedRoster` — the
  // old is_guest_list-registration read this replaced counted a different, comp-era shape.
  // Mapped onto GuestList.tsx's own local Props shape (`people`, `ticketTypeTitle`) rather
  // than the server module's wire shape (`guests`, no title) — see that component's header
  // for why it declares its own types instead of importing the server module's.
  const guestListEntries = await fetchGuestLists(supabase, id);
  const guestLists = guestListEntries.map((list) => ({
    id: list.id,
    listName: list.listName,
    contactName: list.contactName,
    contactEmail: list.contactEmail,
    contactPhone: list.contactPhone,
    people: list.guests.map((g) => ({
      ticketId: g.ticketId,
      name: g.name,
      email: g.email,
      ticketTypeId: g.ticketTypeId,
      ticketTypeTitle: g.ticketTypeId ? ticketTitleById.get(g.ticketTypeId) ?? "" : "",
      checkedIn: g.checkedIn,
    })),
  }));

  // How many sponsors hold a list. The comped TICKET count is derived with the other
  // categories below, off the same registrations — previously it was counted here off
  // `guestLists` and excluded cancelled comps, which made it the one figure in the overview
  // measured after cancellation while the rest were measured before.
  const guestListCount = guestLists.length;

  // The overview counts TICKETS, split by how they were acquired, so each figure means
  // what its label says:
  //
  //   paid + free + guest list − cancelled = active
  //
  // "Paid" is money taken, so it counts tickets PAID FOR — including ones later
  // cancelled, which the cancelled figure then subtracts. Lumping comps in with sold
  // (a guest list is a `free` registration) read as revenue the club never took.
  //
  // Counted off seat-consuming ITEMS rather than `registration.quantity`, mirroring how
  // `seats_used` counts, so the two agree: a non-seat type (merch) mints a ticket but takes
  // no seat, and would otherwise show up in the split and not in the total. The rule lives in
  // lib/events/booked-tickets.ts, where it is testable.
  const {
    paid: paidTickets,
    free: freeTickets,
    guestList: guestListTickets,
    booked: bookedTickets,
  } = splitBookedTickets(
    (registrations ?? []).map((r) => ({
      id: r.id,
      quantity: r.quantity,
      status: r.status,
      is_guest_list: r.is_guest_list,
    })),
    ticketItemRows.map((i) => ({
      registration_id: i.registration_id,
      ticket_type_id: i.ticket_type_id,
      quantity: i.quantity,
    })),
    (id) => ticketTypeById.get(id)?.counts_as_seat === true
  );

  // Tickets still standing. `seats_used` is the authoritative figure: it subtracts cancelled
  // seat-counting tickets and is the same number that gates public registration. Deriving the
  // cap warning from the booked count told an admin an event was overbooked while registration
  // was still open — 23 of 17 on screen against a real 16 of 17.
  let activeTickets = bookedTickets;
  // When the authoritative count is unavailable the cancelled figure below becomes
  // `booked − booked = 0`, which renders as a confident "nothing was cancelled" for an event
  // that may have refunds. Flag it so the breakdown hides rather than lies.
  let figuresDegraded = false;
  try {
    activeTickets = await getSeatsUsed(supabase, id);
  } catch (err) {
    figuresDegraded = true;
    // Fall back to the booked count rather than failing the page. It over-states, so the cap
    // warning errs toward caution.
    console.error("[admin/events/attendees] seat usage failed", { id, err });
  }
  const cancelledTicketCount = Math.max(0, bookedTickets - activeTickets);
  const seatCap = event.seat_cap as number | null;
  const hasSeatCap = seatCap !== null && seatCap !== undefined;
  const overbooked = hasSeatCap && activeTickets > seatCap;
  // R7 (U8): editable per event from the settings page. Enforcement against orders is U2's
  // job, in the register route — this page only surfaces the column for editing.
  const maxTicketsInvite = (event.max_tickets_invite as number | null) ?? null;

  // Widened per U2 of docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md: the
  // admin surface needs what each entry actually asked for (requested type + quantity) and
  // its offer state to decide whether it can be offered — not just name/email/created_at.
  // `offer_token` is deliberately NOT selected: it is a live emailed secret and must never
  // reach the browser — this payload is serialised into the RSC stream on every admin
  // visit. A derived `offered` boolean is exposed instead (built below).
  const { data: rawWaitlist, error: waitlistError } = hasSeatCap
    ? await supabase
        .from("event_waitlist")
        .select(
          "id, name, email, created_at, ticket_type_id, quantity, offered_at, offer_sent_count"
        )
        .eq("event_id", id)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (waitlistError) failLoad("waitlist", waitlistError);

  // Registrations scoped to paid/free are already loaded above — the same set KTD3's
  // redemption check needs (a pending registration never redeems an offer).
  const liveRegistrationsForRedemption = (registrations ?? []).map((r) => ({
    waitlist_entry_id: r.waitlist_entry_id as string | null,
    email: r.email as string,
  }));

  const waitlist = (rawWaitlist ?? []).map((entry) => {
    const ticketType = entry.ticket_type_id
      ? ticketTypeById.get(entry.ticket_type_id) ?? null
      : null;
    // R12: redemption is the entry's OWN linked registration. A bare email match is a
    // separate, weaker signal — it keeps the row visible but blocks the Offer button
    // with a reason, rather than hiding the entry as though it had been redeemed.
    const redeemed = isWaitlistEntryRedeemed(
      { id: entry.id },
      liveRegistrationsForRedemption
    );
    const offerability = deriveWaitlistOfferability({
      ticket_type_id: entry.ticket_type_id,
      quantity: entry.quantity,
      ticketType,
      emailAlreadyRegistered:
        !redeemed &&
        emailAlreadyRegistered({ email: entry.email }, liveRegistrationsForRedemption),
    });
    return {
      id: entry.id,
      name: entry.name,
      email: entry.email,
      created_at: entry.created_at,
      ticket_type_id: entry.ticket_type_id,
      ticket_type_title: ticketType?.title ?? null,
      quantity: entry.quantity,
      offered: entry.offered_at !== null,
      offer_sent_count: entry.offer_sent_count,
      offerable: offerability.offerable,
      offerable_reason: offerability.reason,
      offerable_repairable: offerability.repairable,
      redeemed,
    };
  });

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
        waitlist={waitlist}
        hasSeatCap={hasSeatCap}
        total={activeTickets}
        booked={bookedTickets}
        figuresDegraded={figuresDegraded}
        paidTickets={paidTickets}
        freeTickets={freeTickets}
        cancelledSeats={cancelledTicketCount}
        guestListSeats={guestListTickets}
        guestListCount={guestListCount}
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
        maxTicketsInvite={maxTicketsInvite}
      />
    </div>
  );
}
