import { createAdminClient } from "@/lib/supabase/admin";
import EventManager from "@/components/admin/EventManager";

export default async function EventsPage() {
  const supabase = createAdminClient();

  const { data: events } = await supabase
    .from("events")
    .select("*")
    .order("start_date", { ascending: true });

  const { data: eventTypes } = await supabase
    .from("event_types")
    .select("*")
    .order("sort_order", { ascending: true });

  const { data: seasons } = await supabase
    .from("seasons")
    .select("id, year");

  // Aggregate paid+free seat usage per event so the form can warn when the
  // admin lowers seat_cap below current usage. Postgres-side aggregation
  // avoids the 1000-row default truncation.
  const eventIds = (events ?? [])
    .map((e) => e.id)
    .filter((id): id is string => typeof id === "string");

  const seatsUsedByEvent: Record<string, number> = {};
  if (eventIds.length > 0) {
    const { data: usageRows, error: usageErr } = await supabase.rpc(
      "seats_used_by_events",
      { ids: eventIds }
    );
    if (usageErr) {
      console.error("[admin/events] seat usage rpc failed", usageErr);
    } else {
      for (const row of (usageRows ?? []) as Array<{
        event_id: string;
        seats_used: number;
      }>) {
        if (!row.event_id) continue;
        seatsUsedByEvent[row.event_id] = row.seats_used;
      }
    }
  }

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Events
      </h1>
      <EventManager
        events={events || []}
        eventTypes={eventTypes || []}
        seasons={seasons || []}
        seatsUsedByEvent={seatsUsedByEvent}
      />
    </div>
  );
}
