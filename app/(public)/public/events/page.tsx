import { createAdminClient } from "@/lib/supabase/admin";
import PublicEventsList, {
  type PublicEvent,
  type PublicEventType,
} from "@/components/public/PublicEventsList";
import { getSeatStateByEvent } from "@/lib/events/seat-usage";

export default async function PublicEventsPage() {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, title, start_date, end_date, start_time, location, description, image_url, image_url_2, images, registration_enabled, visibility, event_type_id, seat_cap"
    )
    .eq("is_published", true)
    .gte("start_date", today)
    .order("start_date", { ascending: true });

  const seatStateByEvent = await getSeatStateByEvent(
    supabase,
    (events ?? []).map((e) => ({ id: e.id, seat_cap: e.seat_cap }))
  );

  // Only show event types that have at least one upcoming published event,
  // so the filter row never offers empty buckets.
  const usedTypeIds = new Set(
    (events ?? [])
      .map((e) => e.event_type_id)
      .filter((id): id is string => !!id)
  );

  const { data: allTypes } = await supabase
    .from("event_types")
    .select("id, name, slug, color")
    .order("sort_order", { ascending: true });

  const eventTypes: PublicEventType[] = (allTypes ?? []).filter((t) =>
    usedTypeIds.has(t.id)
  );

  return (
    <>
      <div className="h-20 bg-marine" />
      <div className="bg-cream min-h-[calc(100vh-5rem)] py-12">
        <div className="mx-auto max-w-6xl px-6">
          <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-1">
            Public Events
          </p>
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-marine mb-8">
            Upcoming Events
          </h1>

          <PublicEventsList
            events={(events ?? []) as PublicEvent[]}
            eventTypes={eventTypes}
            seatStateByEvent={seatStateByEvent}
          />
        </div>
      </div>
    </>
  );
}
