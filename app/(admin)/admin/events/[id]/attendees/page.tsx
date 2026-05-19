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
    .select("id, title, start_date, seat_cap")
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

  const seatCap = event.seat_cap;
  const overbooked = seatCap !== null && seatCap !== undefined && total > seatCap;

  const { data: waitlist } = seatCap
    ? await supabase
        .from("event_waitlist")
        .select("id, name, email, created_at")
        .eq("event_id", id)
        .order("created_at", { ascending: true })
    : { data: [] };

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
          <p
            className={`text-sm font-body mt-1 ${
              overbooked ? "text-red-700 font-semibold" : "text-muted-foreground"
            }`}
          >
            Capacity:{" "}
            {seatCap === null || seatCap === undefined
              ? `${total} / ∞ seats (uncapped)`
              : `${total} / ${seatCap} seats${overbooked ? " — overbooked" : ""}`}
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

      {seatCap !== null && seatCap !== undefined && (
        <div className="mt-10">
          <h2 className="font-heading text-xl font-bold text-marine mb-3">
            Waitlist
          </h2>
          {(waitlist?.length ?? 0) === 0 ? (
            <p className="font-body text-sm text-muted-foreground">
              No waitlist entries.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-border/60 bg-white">
              <table className="min-w-full text-sm font-body">
                <thead className="bg-cream/60 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-left">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {(waitlist ?? []).map((entry) => (
                    <tr key={entry.id} className="border-t border-border/60">
                      <td className="px-4 py-2 text-marine">{entry.name}</td>
                      <td className="px-4 py-2">
                        <a
                          href={`mailto:${entry.email}`}
                          className="text-sky-dark hover:text-marine underline-offset-2 hover:underline"
                        >
                          {entry.email}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
