import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSeatsUsed } from "@/lib/events/seat-usage";
import { findRedeemingRegistration } from "@/lib/events/waitlist-offer";
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

  // Session awareness is independent of the token — resolve it alongside the entry
  // lookup rather than after.
  //
  // An auth failure degrades to signed-out, which is safe: it forces a re-auth and
  // cannot mint a member rate. A failed MEMBERSHIP read is different and must not
  // degrade — a Supabase query error does not throw, so treating it as "not a member"
  // silently quotes an active member the non-member price on a public event, and
  // bounces them off a members-only one. Neither failure is visible to anyone.
  async function resolveSession(): Promise<{ isLoggedIn: boolean; isActiveMember: boolean }> {
    let userId: string | null = null;
    try {
      const sessionClient = await createClient();
      const {
        data: { user },
      } = await sessionClient.auth.getUser();
      userId = user?.id ?? null;
    } catch (err) {
      console.error("[public/offers/[token]] session lookup failed", err);
      return { isLoggedIn: false, isActiveMember: false };
    }
    if (!userId) return { isLoggedIn: false, isActiveMember: false };

    const { data: memberRow, error: memberErr } = await supabase
      .from("members")
      .select("id")
      .eq("auth_user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (memberErr) {
      console.error("[public/offers/[token]] member status lookup failed", memberErr);
      throw new Error("Member status lookup failed");
    }
    return { isLoggedIn: true, isActiveMember: Boolean(memberRow) };
  }

  // KTD4: event_waitlist has RLS with no policies — resolve server-side only.
  const [{ data: entryRow, error: entryErr }, { isLoggedIn, isActiveMember }] =
    await Promise.all([
      supabase
        .from("event_waitlist")
        .select("id, email, name, quantity, ticket_type_id, event_id")
        .eq("offer_token", token)
        .limit(1)
        .maybeSingle(),
      resolveSession(),
    ]);
  // A lookup failure is not a bad link. Falling through to the `invalid` panel would
  // tell someone holding a perfectly good offer that their link is forged or expired,
  // and would do it without logging anything.
  if (entryErr) {
    console.error("[public/offers/[token]] entry lookup failed", entryErr);
    throw new Error("Offer lookup failed");
  }

  const entry = entryRow
    ? { id: entryRow.id, email: entryRow.email, quantity: entryRow.quantity }
    : null;

  const { data: event, error: eventErr } = entryRow
    ? await supabase
        .from("events")
        .select("id, title, is_published, registration_enabled, visibility, seat_cap")
        .eq("id", entryRow.event_id)
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  // Same reasoning as the entry lookup: a failed read is not an invalid link.
  if (eventErr) {
    console.error("[public/offers/[token]] event lookup failed", eventErr);
    throw new Error("Offer event lookup failed");
  }

  const eventGate = event
    ? {
        is_published: Boolean(event.is_published),
        registration_enabled: Boolean(event.registration_enabled),
        isMembersOnly: event.visibility !== "public",
      }
    : null;

  // R12: redeemed via the linked registration OR (legacy fallback) any live
  // paid/free registration sharing the entry's email — the same lookup the
  // register route runs before its capacity check, so a second waitlist entry
  // for an already-registered person can't reach checkout only to fail at submit.
  // Independent of the capacity check below, so both run concurrently.
  async function resolveRedemption(): Promise<{ reference_code: string } | null> {
    if (!entry || !event) return null;
    const { data: redeeming, error } = await findRedeemingRegistration(
      supabase,
      event.id,
      entry
    );
    // Fail closed, like resolveSeatsFree below: treating "we couldn't check" as
    // "not redeemed" would hand a fresh checkout form to someone who has already
    // paid. An error page is the honest outcome — every other call site 503s here.
    if (error) {
      console.error("[offer-landing] redemption check failed", { eventId: event.id, err: error });
      throw new Error("Offer redemption check failed");
    }
    return redeeming ? { reference_code: redeeming.reference_code } : null;
  }

  // Capacity: only seat-consuming registrations count against the cap (mirrors
  // getSeatsUsed's own accounting). null seat_cap means uncapped.
  async function resolveSeatsFree(): Promise<number | null> {
    if (!event || event.seat_cap === null || event.seat_cap === undefined) return null;
    try {
      const seatsUsed = await getSeatsUsed(supabase, event.id);
      return event.seat_cap - seatsUsed;
    } catch (err) {
      console.error("[public/offers/[token]] seat usage lookup failed", err);
      return 0; // fail closed: never show a checkout form we can't back
    }
  }

  const [redeemedRegistration, seatsFree] = await Promise.all([
    resolveRedemption(),
    resolveSeatsFree(),
  ]);

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
  const { data: rawTicketTypes, error: ticketTypesErr } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, description, sort_order, counts_as_seat")
    .eq("event_id", event!.id)
    .eq("counts_as_seat", true)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });
  // Without this check an empty result renders "Registration details coming soon",
  // which reads as an admin who hasn't finished setting the event up — a dead end
  // for a live, seat-backed offer, and indistinguishable from the real thing.
  if (ticketTypesErr) {
    console.error("[public/offers/[token]] ticket type lookup failed", ticketTypesErr);
    throw new Error("Offer ticket type lookup failed");
  }

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
