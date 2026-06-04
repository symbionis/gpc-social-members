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
          This pre-registration link isn’t valid. Please ask the person who
          invited you for the current link.
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
          This pre-registration isn’t confirmed yet. Please try again once the
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
    .select("id, ticket_type_id")
    .eq("registration_id", registration.id)
    .eq("slot_status", "claimed")
    .is("released_at", null);

  const quantity = (registration.quantity as number) ?? 0;
  const remaining = Math.max(0, quantity - (claimed?.length ?? 0));

  // The ticket types this party purchased, MINUS any whose allotment is already
  // claimed — so a taken type (e.g. the last "Without Asado") is no longer offered.
  // Per-type remaining = purchased(type) − claimed-attendees-holding(type). We offer
  // only what's both bought and still open; the claim RPC enforces the same cap.
  const { data: ticketItems } = await supabase
    .from("event_registration_items")
    .select("ticket_type_id, title_snapshot, quantity, created_at")
    .eq("registration_id", registration.id)
    .order("created_at", { ascending: true });

  const claimedByType = new Map<string, number>();
  for (const a of claimed ?? []) {
    const tid = a.ticket_type_id as string | null;
    if (tid) claimedByType.set(tid, (claimedByType.get(tid) ?? 0) + 1);
  }

  // Purchased quantity + first-seen title per type (insertion order = purchase order).
  const purchasedByType = new Map<string, { title: string; qty: number }>();
  for (const item of ticketItems ?? []) {
    const id = item.ticket_type_id as string | null;
    if (!id) continue;
    const prev = purchasedByType.get(id);
    const qty = (item.quantity as number | null) ?? 0;
    if (prev) prev.qty += qty;
    else
      purchasedByType.set(id, {
        title: (item.title_snapshot as string | null)?.trim() || "Ticket",
        qty,
      });
  }

  // Children's ticket types are offered as an "add children by name" control, not in
  // the adult selector. Split the purchased types accordingly.
  const { data: typeRows } = await supabase
    .from("event_ticket_types")
    .select("id, is_child")
    .eq("event_id", registration.event_id);
  const isChildById = new Map<string, boolean>();
  for (const t of typeRows ?? []) isChildById.set(t.id as string, Boolean(t.is_child));

  const ticketTypes: { id: string; title: string }[] = [];
  let childRemaining = 0;
  let childTypeCount = 0;
  for (const [id, { title, qty }] of purchasedByType) {
    const left = qty - (claimedByType.get(id) ?? 0);
    if (isChildById.get(id)) {
      childTypeCount += 1;
      if (left > 0) childRemaining += left;
    } else if (left > 0) {
      ticketTypes.push({ id, title });
    }
  }
  // Only the single-child-type case is supported by the name-only control (the RPC
  // rejects the rare multi-child-type party); hide it otherwise.
  if (childTypeCount > 1) childRemaining = 0;

  return shell(
    <SelfRegistrationForm
      token={token}
      eventTitle={event.title as string}
      eventDate={formatDate(event.start_date as string)}
      leadName={(registration.name as string | null) ?? ""}
      remaining={remaining}
      ticketTypes={ticketTypes}
      childRemaining={childRemaining}
    />
  );
}
