import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { resolveOfferLandingOutcome } from "@/lib/events/offer-landing";
import OfferTerminalPanel from "@/components/public/OfferTerminalPanel";
import EventRegistrationForm, { type TicketTypeOption } from "@/components/public/EventRegistrationForm";

// KTD4/KTD5: the token is a long-lived emailed secret. Never let it ride out in a
// Referer header — the event description on other public pages renders arbitrary
// outbound links, so this mirrors the manage_token precedent in
// app/(checkin)/public/bookings/[token]/page.tsx.
export const metadata: Metadata = { referrer: "no-referrer" };

export default async function OfferLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ registered?: string; cancelled?: string }>;
}) {
  const { token } = await params;
  const { registered, cancelled } = await searchParams;
  const supabase = createAdminClient();

  // KTD4: event_waitlist has RLS with no policies — resolve server-side only.
  const { data: entryRow } = await supabase
    .from("event_waitlist")
    .select("id, email, name, quantity, ticket_type_id, event_id")
    .eq("offer_token", token)
    .limit(1)
    .maybeSingle();

  const entry = entryRow
    ? { id: entryRow.id, email: entryRow.email, quantity: entryRow.quantity }
    : null;

  const { data: event } = entryRow
    ? await supabase
        .from("events")
        .select("id, title, is_published, registration_enabled, visibility, seat_cap")
        .eq("id", entryRow.event_id)
        .limit(1)
        .maybeSingle()
    : { data: null };

  const eventGate = event
    ? {
        is_published: Boolean(event.is_published),
        registration_enabled: Boolean(event.registration_enabled),
        isMembersOnly: event.visibility !== "public",
      }
    : null;

  // Session awareness. Any failure here degrades to signed-out rendering — a
  // landing that can't check the session must not silently grant a member rate.
  let isLoggedIn = false;
  let isActiveMember = false;
  try {
    const sessionClient = await createClient();
    const {
      data: { user },
    } = await sessionClient.auth.getUser();
    if (user?.id) {
      isLoggedIn = true;
      const { data: memberRow } = await supabase
        .from("members")
        .select("id")
        .eq("auth_user_id", user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (memberRow) isActiveMember = true;
    }
  } catch (err) {
    console.error("[public/offers/[token]] session lookup failed", err);
  }

  // R12: redeemed via the linked registration OR (legacy fallback) any live
  // paid/free registration sharing the entry's email — the same lookup the
  // register route runs before its capacity check, so a second waitlist entry
  // for an already-registered person can't reach checkout only to fail at submit.
  let redeemedRegistration: { reference_code: string } | null = null;
  if (entry && event) {
    const { data: liveRegs } = await supabase
      .from("event_registrations")
      .select("waitlist_entry_id, email, reference_code")
      .eq("event_id", event.id)
      .in("status", ["paid", "free"]);
    const emailLower = entry.email.trim().toLowerCase();
    const match = (liveRegs ?? []).find(
      (r) => r.waitlist_entry_id === entry.id || r.email.trim().toLowerCase() === emailLower
    );
    if (match) redeemedRegistration = { reference_code: match.reference_code };
  }

  // Capacity: only seat-consuming registrations count against the cap (mirrors
  // getSeatsUsed's own accounting). null seat_cap means uncapped.
  let seatsFree: number | null = null;
  if (event && event.seat_cap !== null && event.seat_cap !== undefined) {
    try {
      const seatsUsed = await getSeatsUsed(supabase, event.id);
      seatsFree = event.seat_cap - seatsUsed;
    } catch (err) {
      console.error("[public/offers/[token]] seat usage lookup failed", err);
      seatsFree = 0; // fail closed: never show a checkout form we can't back
    }
  }

  const loginUrl = `/login?next=${encodeURIComponent(`/public/offers/${token}`)}`;

  const outcome = resolveOfferLandingOutcome({
    entry,
    event: eventGate,
    isLoggedIn,
    isActiveMember,
    redeemedRegistration,
    seatsFree,
    loginUrl,
  });

  if (outcome.kind === "signin_redirect") {
    redirect(outcome.loginUrl);
  }

  const banner = (
    <>
      {registered === "1" && (
        <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-4 mb-4">
          <p className="font-body text-sm text-emerald-900">
            Registration confirmed. A confirmation email is on its way — check your inbox.
          </p>
        </div>
      )}
      {cancelled === "1" && (
        <div className="rounded-sm border border-amber-200 bg-amber-50 p-4 mb-4">
          <p className="font-body text-sm text-amber-900">
            Checkout cancelled. Your registration has not been confirmed — you can try again
            below while seats last.
          </p>
        </div>
      )}
    </>
  );

  if (outcome.kind === "invalid") return <OfferTerminalPanel kind="invalid" />;
  if (outcome.kind === "closed") return <OfferTerminalPanel kind="closed" />;
  if (outcome.kind === "members_only") return <OfferTerminalPanel kind="members_only" />;
  if (outcome.kind === "already_registered") {
    return (
      <OfferTerminalPanel
        kind="already_registered"
        eventTitle={event?.title}
        referenceCode={outcome.referenceCode}
      />
    );
  }
  if (outcome.kind === "seats_gone") {
    return (
      <div className="min-h-screen bg-cream">
        <div className="h-16 bg-marine" />
        <div className="mx-auto max-w-md px-5 py-8 sm:py-10">
          {banner}
          <OfferTerminalPanel kind="seats_gone" />
        </div>
      </div>
    );
  }

  // outcome.kind === "checkout" from here.
  // KTD6: only seat-counting, non-archived types are offered — a non-seat type
  // would let the redemption skip the capacity it was meant to consume.
  const { data: rawTicketTypes } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, description, sort_order, counts_as_seat")
    .eq("event_id", event!.id)
    .eq("counts_as_seat", true)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });

  // KTD7: pricing is session-derived, never token-derived — the member rate only
  // applies to a session already confirmed active member above.
  const ticketTypeOptions: TicketTypeOption[] = (rawTicketTypes ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    price: isActiveMember ? t.price_member : t.price_non_member,
  }));

  const preselectedTypeId =
    entryRow?.ticket_type_id &&
    ticketTypeOptions.some((t) => t.id === entryRow.ticket_type_id && t.price !== null)
      ? entryRow.ticket_type_id
      : undefined;

  return (
    <div className="min-h-screen bg-cream">
      <div className="h-16 bg-marine" />
      <div className="mx-auto max-w-md px-5 py-8 sm:py-10">
        {banner}
        <div className="bg-white rounded-sm border border-border/60 p-5">
          <p className="text-xs font-body text-muted-foreground uppercase tracking-wide mb-1">
            You&apos;re invited
          </p>
          <h1 className="font-heading text-xl font-bold text-marine mb-4">{event!.title}</h1>
          {ticketTypeOptions.length === 0 ? (
            <p className="font-body text-sm text-muted-foreground">
              Registration details coming soon.
            </p>
          ) : (
            <EventRegistrationForm
              eventId={event!.id}
              ticketTypes={ticketTypeOptions}
              offer={{
                token,
                redeemableQuantity: outcome.redeemableQuantity,
                email: entryRow!.email,
                name: entryRow!.name ?? undefined,
                ticketTypeId: preselectedTypeId,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
