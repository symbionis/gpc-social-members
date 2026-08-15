import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePayerTicket, type PayerCandidateTicket } from "@/lib/events/booking-redirect";

// Don't leak the secret manage_token to outbound links / analytics via Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

// Lead "My Booking" page (U4 / FEAT-41), a redirect-only surface (U3 of
// docs/plans/2026-08-11-002-feat-consolidate-ticket-surfaces-plan.md, R18/KTD2). An old
// booking-page link — already sent in past confirmation emails — still resolves by
// manage_token and sends the payer straight to their own ticket manage page at
// /public/tickets/[token] instead of rendering a booking-page surface here.
//
// Comp tickets are retired (U7/R16/KD7): this page used to carry a second branch that
// rendered CompGuestListManager for a sponsor's comp guest list (event_registrations.
// is_guest_list) instead of redirecting. That branch — and the component — are gone. A
// comp list's lead ticket is `is_lead = true` exactly like any other registration's, so an
// old comp-list manage-link now redirects here too, landing on the lead's own ticket page
// rather than the retired whole-party view.
export default async function BookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-cream">
      <div className="h-16 bg-marine" />
      <div className="mx-auto max-w-md px-5 py-8 sm:py-10">{body}</div>
    </div>
  );

  const notice = (heading: string, message: string, tone: "neutral" | "warn" = "neutral") => (
    <div
      className={
        tone === "warn"
          ? "rounded-2xl border border-amber-300 bg-amber-50 p-8 text-center shadow-sm"
          : "rounded-2xl border border-border/60 bg-white p-8 text-center shadow-sm"
      }
    >
      <h1
        className={`font-heading text-xl font-bold mb-2 ${
          tone === "warn" ? "text-amber-900" : "text-marine"
        }`}
      >
        {heading}
      </h1>
      <p className={`font-body text-sm ${tone === "warn" ? "text-amber-900/80" : "text-marine/70"}`}>
        {message}
      </p>
    </div>
  );

  const { data: registration } = await supabase
    .from("event_registrations")
    .select("id, event_id, email, status")
    .eq("manage_token", token)
    .limit(1)
    .maybeSingle();

  if (!registration) {
    return shell(
      notice("Booking not found", "This booking link isn’t valid. Please check the link in your confirmation email.")
    );
  }

  // Pending payment → the webhook hasn't minted tickets yet (Q-Booking).
  if (registration.status !== "paid" && registration.status !== "free") {
    return shell(
      notice(
        "Payment processing",
        "Your booking is being confirmed. This page will show your tickets and their QR codes once payment completes — please check back shortly.",
        "warn"
      )
    );
  }

  const { data: event } = await supabase
    .from("events")
    .select("id, is_published")
    .eq("id", registration.event_id)
    .limit(1)
    .maybeSingle();

  if (!event || !event.is_published) {
    return shell(notice("Event unavailable", "This event isn’t available right now."));
  }

  // Redirect-only surface (R18/KTD2): resolve the payer's own live ticket and send them to its
  // manage page. Every registration takes this path now that the comp branch is retired (U7)
  // — including an old comp guest list's lead, whose ticket is `is_lead = true` exactly like
  // any other registration's.
  const { data: payerTicketRows } = await supabase
    .from("tickets")
    .select("id, email, manage_token, is_lead, created_at")
    .eq("registration_id", registration.id)
    .in("slot_status", ["issued", "claimed"])
    .is("released_at", null);

  const candidates: PayerCandidateTicket[] = (payerTicketRows ?? []).map((t) => ({
    id: t.id as string,
    email: (t.email as string | null) ?? null,
    manageToken: (t.manage_token as string | null) ?? null,
    isLead: Boolean(t.is_lead),
    createdAt: String(t.created_at),
  }));

  const payerTicket = resolvePayerTicket((registration.email as string | null) ?? null, candidates);

  if (!payerTicket) {
    return shell(
      notice(
        "Booking details",
        "This booking’s ticket isn’t currently active — it may have been cancelled or released. Contact us if you think this is a mistake."
      )
    );
  }

  redirect(`/public/tickets/${payerTicket.manageToken}`);
}
