import type { Metadata } from "next";
import { resolveDoorEvent, buildDoorRoster } from "@/lib/events/door-access";
import DoorConsole from "@/components/door/DoorConsole";
import ScanCheckIn from "@/components/door/ScanCheckIn";
import { formatDate } from "@/lib/format";

// Keep the event id out of the Referer header on any outbound link / asset.
export const metadata: Metadata = { referrer: "no-referrer" };

// Public, no-login door console (U4/U5/U11). Keyed on the event id (KTD1). Volunteer
// staff open `/door/<eventId>` to browse/search the full roster (parties with their
// guests), show a party's self-reg QR for a walk-up, free a not-yet-arrived guest's
// slot, and watch arrivals. Guests self-check-in and self-register on the public
// kiosk/self-reg pages. Lives in the (checkin) route group (no site chrome).
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

  const {
    parties,
    arrivals,
    notArrived,
    arrived,
    expected,
    outstanding,
    unaccounted,
  } = await buildDoorRoster(id);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return shell(
    <div className="space-y-6">
      {/* Primary check-in path: scan the guest's QR (U7). The roster below covers
          walk-ups (fill an inviter's open slot) and lost-QR name/contact lookup. */}
      <ScanCheckIn eventId={event.id} />
      <DoorConsole
        eventId={event.id}
        eventTitle={event.title}
        eventDate={event.startDate ? formatDate(event.startDate) : ""}
        baseUrl={baseUrl}
        parties={parties}
        arrivals={arrivals}
        notArrived={notArrived}
        arrivedCount={arrived}
        expectedCount={expected}
        outstandingCount={outstanding}
        unaccountedCount={unaccounted}
      />
    </div>
  );
}
