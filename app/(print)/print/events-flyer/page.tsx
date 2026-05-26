import { requireAdminUser } from "@/lib/auth/admin";
import { getFlyerEvents, getMemberEventsUrl } from "@/lib/events/flyer";
import EventsFlyer from "@/components/events/EventsFlyer";

// Always render fresh: gated on live auth and reflects the current confirmed
// event set, so it must not be statically cached.
export const dynamic = "force-dynamic";

export default async function EventsFlyerPage() {
  // Auth runs before any event data is fetched — an unauthorized request never
  // touches the events query.
  await requireAdminUser();

  const events = await getFlyerEvents();

  return <EventsFlyer events={events} memberEventsUrl={getMemberEventsUrl()} />;
}
