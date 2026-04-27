import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import AttendeeList from "@/components/admin/AttendeeList";

export default async function EventAttendeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title, start_date")
    .eq("id", id)
    .single();

  if (!event) notFound();

  const { data: attendees } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, is_member, quantity, total_amount_chf, status, reference_code, created_at, checked_in_at"
    )
    .eq("event_id", id)
    .in("status", ["paid", "free"])
    .order("created_at", { ascending: false });

  const total = (attendees || []).reduce((acc, a) => acc + a.quantity, 0);

  return (
    <div>
      <Link
        href="/admin/events"
        className="inline-flex items-center gap-1 text-sm font-body text-muted-foreground hover:text-marine transition-colors mb-4"
      >
        ← Back to Events
      </Link>

      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="font-accent text-xs tracking-[0.3em] uppercase text-sky-dark mb-1">
            Attendees
          </p>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine">
            {event.title}
          </h1>
          <p className="text-sm font-body text-muted-foreground mt-1">
            {(attendees || []).length} registration
            {(attendees || []).length === 1 ? "" : "s"} · {total} ticket
            {total === 1 ? "" : "s"}
          </p>
        </div>
        <a
          href={`/api/admin/events/${id}/attendees?format=csv`}
          className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors"
        >
          Export CSV
        </a>
      </div>

      <AttendeeList eventId={id} attendees={attendees || []} />
    </div>
  );
}
