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
  // admin lowers seat_cap below current usage. One query, summed in app code.
  const { data: usageRows } = await supabase
    .from("event_registrations")
    .select("event_id, quantity")
    .in("status", ["paid", "free"]);

  const seatsUsedByEvent: Record<string, number> = {};
  for (const row of usageRows ?? []) {
    if (!row.event_id) continue;
    seatsUsedByEvent[row.event_id] =
      (seatsUsedByEvent[row.event_id] ?? 0) + (row.quantity ?? 0);
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
