import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import SelfRegistrationForm from "@/components/public/SelfRegistrationForm";
import { formatDate } from "@/lib/format";

// Don't leak the secret token to outbound links / analytics via the Referer header.
export const metadata: Metadata = { referrer: "no-referrer" };

// Public, unauthenticated guest self-registration page (U9). Reached via the
// per-party link the lead shares (carried in the confirmation email, U10). Lives in
// the (checkin) route group so it renders without the marketing site chrome — a
// focused, kiosk-style flow like the door check-in. The token in the path scopes
// everything to one registration.
export default async function SelfRegistrationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: registration } = await supabase
    .from("event_registrations")
    .select("id, event_id, name, quantity, status")
    .eq("self_reg_token", token)
    .limit(1)
    .maybeSingle();

  // Card shell mirrors the door check-in page (marine bar + cream + centered card).
  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-cream">
      <div className="h-16 bg-marine" />
      <div className="mx-auto max-w-md px-5 py-8 sm:py-10">{body}</div>
    </div>
  );

  if (!registration) {
    return shell(
      <div className="rounded-2xl border border-border/60 bg-white p-8 text-center shadow-sm">
        <h1 className="font-heading text-xl font-bold text-marine mb-2">
          Link not found
        </h1>
        <p className="font-body text-sm text-marine/70">
          This registration link isn’t valid. Please ask the person who invited
          you for the current link.
        </p>
      </div>
    );
  }

  if (registration.status !== "paid" && registration.status !== "free") {
    return shell(
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-8 text-center shadow-sm">
        <h1 className="font-heading text-xl font-bold text-amber-900 mb-2">
          Not confirmed yet
        </h1>
        <p className="font-body text-sm text-amber-900/80">
          This registration isn’t confirmed yet. Please try again once the
          booking is complete.
        </p>
      </div>
    );
  }

  const { data: event } = await supabase
    .from("events")
    .select("id, title, start_date, is_published")
    .eq("id", registration.event_id)
    .limit(1)
    .maybeSingle();

  if (!event || !event.is_published) {
    return shell(
      <div className="rounded-2xl border border-border/60 bg-white p-8 text-center shadow-sm">
        <h1 className="font-heading text-xl font-bold text-marine mb-2">
          Event unavailable
        </h1>
        <p className="font-body text-sm text-marine/70">
          This event isn’t available. Please contact the person who invited you.
        </p>
      </div>
    );
  }

  // Remaining slots = purchased quantity − already-claimed attendees (the lead
  // counts). The claim RPC re-derives this under a row lock, so this read is only
  // for display; a race that fills the last slot is reported at submit time.
  const { data: claimed } = await supabase
    .from("event_attendees")
    .select("id")
    .eq("registration_id", registration.id)
    .eq("slot_status", "claimed");

  const quantity = (registration.quantity as number) ?? 0;
  const remaining = Math.max(0, quantity - (claimed?.length ?? 0));

  // The ticket types this party actually purchased (e.g. asado meal options) — the
  // guest picks theirs. We offer only what was bought so catering stays coherent;
  // a single-type party needs no selector (the claim RPC auto-assigns it).
  const { data: ticketItems } = await supabase
    .from("event_registration_items")
    .select("ticket_type_id, title_snapshot, created_at")
    .eq("registration_id", registration.id)
    .order("created_at", { ascending: true });

  const ticketTypes: { id: string; title: string }[] = [];
  const seenTypes = new Set<string>();
  for (const item of ticketItems ?? []) {
    const id = item.ticket_type_id as string | null;
    if (!id || seenTypes.has(id)) continue;
    seenTypes.add(id);
    ticketTypes.push({ id, title: (item.title_snapshot as string | null)?.trim() || "Ticket" });
  }

  return shell(
    <SelfRegistrationForm
      token={token}
      eventTitle={event.title as string}
      eventDate={formatDate(event.start_date as string)}
      leadName={(registration.name as string | null) ?? ""}
      remaining={remaining}
      ticketTypes={ticketTypes}
    />
  );
}
