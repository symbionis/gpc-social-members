import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import BookingManager, { type BookingTicket } from "@/components/public/BookingManager";
import { credentialUrl } from "@/lib/events/credential";
import { formatDate, formatCurrency } from "@/lib/format";

// Don't leak the secret manage_token to outbound links / analytics via Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

// Lead "My Booking" page (U4 / FEAT-41). Reached via the per-booking manage_token
// link in the confirmation email. The lead sees the whole party — every ticket with
// its QR — and can name each ticket (which binds that QR to a guest). Lives in the
// (checkin) route group so it renders kiosk-style without the marketing chrome.
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
    .select("id, event_id, name, quantity, status, reference_code, is_member")
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
    .select("id, title, start_date, is_published")
    .eq("id", registration.event_id)
    .limit(1)
    .maybeSingle();

  if (!event || !event.is_published) {
    return shell(notice("Event unavailable", "This event isn’t available right now."));
  }

  // Every live ticket in the party (issued = unnamed/open, claimed = named), each
  // with its own credential for the QR. Released tombstones are excluded.
  const { data: ticketRows } = await supabase
    .from("tickets")
    .select(
      "id, name, email, phone_e164, ticket_type_id, slot_status, credential_token, is_child, checked_in_at, is_lead, created_at"
    )
    .eq("registration_id", registration.id)
    .in("slot_status", ["issued", "claimed"])
    .is("released_at", null);

  const { data: typeRows } = await supabase
    .from("event_ticket_types")
    .select("id, title, is_child, sort_order, price_member, price_non_member, archived_at")
    .eq("event_id", registration.event_id);
  const titleById = new Map<string, string>();
  const isChildById = new Map<string, boolean>();
  const sortById = new Map<string, number>();
  for (const t of typeRows ?? []) {
    titleById.set(t.id as string, (t.title as string | null) ?? "");
    isChildById.set(t.id as string, Boolean(t.is_child));
    sortById.set(t.id as string, (t.sort_order as number | null) ?? 0);
  }

  // Ticket types the lead can buy more of: active types, priced at the booking's rate.
  const buyableTypes = (typeRows ?? [])
    .filter((t) => !t.archived_at)
    .sort((a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0))
    .map((t) => {
      const unit = registration.is_member ? t.price_member : t.price_non_member;
      const amount = unit === null ? null : Number(unit);
      return {
        id: t.id as string,
        title: (t.title as string | null) ?? "Ticket",
        priceLabel:
          amount === null || !Number.isFinite(amount)
            ? "—"
            : amount === 0
              ? "Free"
              : formatCurrency(amount),
      };
    })
    .filter((t) => t.priceLabel !== "—");

  const tickets: BookingTicket[] = (ticketRows ?? [])
    .slice()
    .sort((a, b) => {
      // Lead first, then by type order, then mint order.
      if (Boolean(a.is_lead) !== Boolean(b.is_lead)) return a.is_lead ? -1 : 1;
      const sa = a.ticket_type_id ? sortById.get(a.ticket_type_id as string) ?? 0 : 0;
      const sb = b.ticket_type_id ? sortById.get(b.ticket_type_id as string) ?? 0 : 0;
      if (sa !== sb) return sa - sb;
      return String(a.created_at).localeCompare(String(b.created_at));
    })
    .map((t) => {
      const typeId = t.ticket_type_id as string | null;
      return {
        id: t.id as string,
        name: (t.name as string | null) ?? "",
        email: (t.email as string | null) ?? "",
        phone: (t.phone_e164 as string | null) ?? "",
        typeTitle: typeId ? titleById.get(typeId) ?? "" : "",
        isChild: (t.is_child as boolean | null) ?? (typeId ? isChildById.get(typeId) ?? false : false),
        status: t.slot_status as string,
        checkedIn: t.checked_in_at !== null,
        credentialUrl: credentialUrl((t.credential_token as string | null) ?? ""),
      };
    });

  return shell(
    <BookingManager
      eventTitle={event.title as string}
      eventDate={formatDate(event.start_date as string)}
      referenceCode={(registration.reference_code as string | null) ?? ""}
      quantity={(registration.quantity as number) ?? tickets.length}
      tickets={tickets}
      fillEndpoint={`/api/public/bookings/${token}/fill`}
      forwardEndpoint={`/api/public/bookings/${token}/forward`}
      topupEndpoint={`/api/public/bookings/${token}/topup`}
      buyableTypes={buyableTypes}
      variant="booking"
    />
  );
}
