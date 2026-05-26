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
    .select("id, slug");

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Events
      </h1>
      <EventManager
        events={events || []}
        eventTypes={eventTypes || []}
        seasons={seasons || []}
      />
    </div>
  );
}
