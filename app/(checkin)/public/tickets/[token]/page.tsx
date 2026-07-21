import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHousehold } from "@/lib/events/household";
import { googleCalendarUrl } from "@/lib/events/calendar";
import { resolvePrice, isUsablePrice } from "@/lib/events/pricing";
import type { ConvertType } from "@/lib/events/convert-eligibility";
import TicketManager, { type ManageTicket } from "@/components/public/TicketManager";
import { formatDate } from "@/lib/format";

// Don't leak the secret manage_token to outbound links / analytics via Referer.
export const metadata: Metadata = { referrer: "no-referrer" };

// Guest manage page (U10). Reached via a per-ticket manage_token link (e.g. from the
// grouped household email, U12). Shows every same-email ticket in the booking with its own
// QR, the event details, and an add-to-calendar link. Lives in the (checkin) route group so
// it renders kiosk-style without the marketing chrome, mirroring the lead booking page.
export default async function TicketManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const shell = (body: ReactNode) => (
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

  const household = await resolveHousehold(token);

  if (!household) {
    return shell(
      notice(
        "Ticket not found",
        "This ticket link isn’t valid. It may have been renewed — please check the most recent link in your email."
      )
    );
  }

  if (household.status !== "paid" && household.status !== "free") {
    return shell(
      notice(
        "Payment processing",
        "Your booking is being confirmed. This page will show your ticket and its QR code once payment completes — please check back shortly.",
        "warn"
      )
    );
  }

  if (!household.eventPublished) {
    return shell(notice("Event unavailable", "This event isn’t available right now."));
  }

  const tickets: ManageTicket[] = household.tickets.map((t) => ({
    id: t.id,
    name: t.name,
    email: t.email,
    typeId: t.typeId,
    typeTitle: t.typeTitle,
    checkedIn: t.checkedIn,
    credentialUrl: t.credentialUrl,
    isSelf: t.isSelf,
  }));

  // Upgrade targets: active types priced at the household's rate (member/non-member with
  // the invite fallback, U11). The client filters per ticket to same-or-higher priced.
  const supabase = createAdminClient();
  const { data: typeRows } = await supabase
    .from("event_ticket_types")
    .select("id, title, price_member, price_non_member, invite_price, archived_at")
    .eq("event_id", household.event.id);
  const convertTypes: ConvertType[] = (typeRows ?? [])
    .filter((t) => !t.archived_at)
    .map((t) => {
      const unit = resolvePrice(t, { is_member: household.isMember });
      return { id: t.id as string, title: (t.title as string | null) ?? "Ticket", price: unit };
    })
    .filter((t): t is ConvertType => isUsablePrice(t.price));

  return shell(
    <TicketManager
      eventTitle={household.event.title}
      eventDate={formatDate(household.event.startDate)}
      eventLocation={household.event.location}
      referenceCode={household.referenceCode}
      calendarUrl={googleCalendarUrl({
        title: household.event.title,
        startDate: household.event.startDate,
        startTime: household.event.startTime,
        endDate: household.event.endDate,
        location: household.event.location,
        description: household.event.description,
      })}
      tickets={tickets}
      fillEndpoint={`/api/public/bookings/${token}/fill`}
      convertEndpoint={`/api/public/bookings/${token}/convert`}
      convertTypes={convertTypes}
    />
  );
}
