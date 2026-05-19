import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import MemberEventsGrid, {
  type MemberEvent,
  type MemberEventType,
} from "@/components/member/MemberEventsGrid";
import { getSeatStateByEvent } from "@/lib/events/seat-usage";

export default async function EventsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select("id, status")
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member || member.status !== "active") {
    redirect("/dashboard");
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: events } = await adminClient
    .from("events")
    .select(
      "id, title, start_date, end_date, start_time, location, description, image_url, image_url_2, images, visibility, is_confirmed, event_type_id, registration_enabled, seat_cap"
    )
    .eq("is_published", true)
    .gte("start_date", today)
    .order("start_date", { ascending: true });

  // Degrade gracefully on seat-usage failure: render the listing without
  // capacity badges rather than crashing the whole page.
  let seatStateByEvent: Awaited<ReturnType<typeof getSeatStateByEvent>> = {};
  try {
    seatStateByEvent = await getSeatStateByEvent(
      adminClient,
      (events ?? []).map((e) => ({ id: e.id, seat_cap: e.seat_cap }))
    );
  } catch (err) {
    console.error("[member/events] seat usage lookup failed", err);
  }

  const usedTypeIds = new Set(
    (events ?? [])
      .map((e) => e.event_type_id)
      .filter((id): id is string => !!id)
  );

  const { data: allTypes } = await adminClient
    .from("event_types")
    .select("id, name, slug, color")
    .order("sort_order", { ascending: true });

  const eventTypes: MemberEventType[] = (allTypes ?? []).filter((t) =>
    usedTypeIds.has(t.id)
  );

  return (
    <div>
      <p className="font-accent text-base tracking-[0.3em] uppercase text-sky-dark mb-1">
        Season Calendar
      </p>
      <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine mb-6">
        Events
      </h1>

      <MemberEventsGrid
        events={(events ?? []) as MemberEvent[]}
        eventTypes={eventTypes}
        seatStateByEvent={seatStateByEvent}
      />

      <div className="mt-8">
        <Link
          href="/dashboard"
          className="text-sm font-body text-muted-foreground hover:text-marine transition-colors"
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
