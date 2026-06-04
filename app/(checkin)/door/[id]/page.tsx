import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDoorEvent } from "@/lib/events/door-access";
import DoorConsole from "@/components/door/DoorConsole";
import { formatDate } from "@/lib/format";

// Keep the event id out of the Referer header on any outbound link / asset.
export const metadata: Metadata = { referrer: "no-referrer" };

// Public, no-login door console (U4/U5). Keyed on the event id (KTD1). Volunteer
// staff open `/door/<eventId>` to search a party, see its fill + claimed list,
// show its self-reg QR for a walk-up guest, and watch arrivals. Read-only —
// guests still self-check-in and self-register on the public kiosk/self-reg pages.
// Lives in the (checkin) route group so it renders without site chrome.
export default async function DoorConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-cream">
      <div className="h-16 bg-marine" />
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-10">{body}</div>
    </div>
  );

  const event = await resolveDoorEvent(id);
  if (!event) {
    return shell(
      <div className="rounded-2xl border border-border/60 bg-white p-8 text-center shadow-sm">
        <h1 className="font-heading text-xl font-bold text-marine mb-2">
          Not available
        </h1>
        <p className="font-body text-sm text-marine/70">
          This door link isn’t valid. Please ask the organizer for the current
          link.
        </p>
      </div>
    );
  }

  // Arrivals (U5): arrived = claimed attendees with a check-in time; expected =
  // total tickets sold. Read here and passed in; the console soft-refreshes the
  // page to keep them current during the event.
  const supabase = createAdminClient();
  const { data: regs } = await supabase
    .from("event_registrations")
    .select("quantity")
    .eq("event_id", id)
    .in("status", ["paid", "free"]);
  const expected = (regs ?? []).reduce(
    (sum, r) => sum + ((r.quantity as number) ?? 0),
    0
  );

  const { data: claimed } = await supabase
    .from("event_attendees")
    .select("id, name, checked_in_at")
    .eq("event_id", id)
    .eq("slot_status", "claimed");

  const arrivals = (claimed ?? [])
    .filter((a) => a.checked_in_at !== null)
    .sort((a, b) =>
      (b.checked_in_at as string).localeCompare(a.checked_in_at as string)
    )
    .map((a) => ({
      id: a.id as string,
      name: (a.name as string | null) ?? "",
      arrivedAt: a.checked_in_at as string,
    }));

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return shell(
    <DoorConsole
      eventId={event.id}
      eventTitle={event.title}
      eventDate={event.startDate ? formatDate(event.startDate) : ""}
      baseUrl={baseUrl}
      arrivedCount={arrivals.length}
      expectedCount={expected}
      arrivals={arrivals}
    />
  );
}
