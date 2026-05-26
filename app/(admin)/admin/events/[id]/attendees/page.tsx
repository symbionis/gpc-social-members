import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import ManageEventTabs from "@/components/admin/ManageEventTabs";
import { getEventReminderSummary } from "@/lib/events/reminder-summary";
import { validateReminderSchedule } from "@/lib/events/reminder-schedule";

export default async function ManageEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, start_date, seat_cap, strict_checkin, reminder_schedule, visibility, registration_enabled, invite_code, invite_price"
    )
    .eq("id", id)
    .single();

  if (!event) notFound();

  const { data: registrations } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, is_member, quantity, total_amount_chf, status, reference_code, created_at"
    )
    .eq("event_id", id)
    .in("status", ["paid", "free"])
    .order("created_at", { ascending: false });

  // event_checkins is the single source of arrival truth. A registration has
  // arrived iff a row links to it; rows without a registration_id are walk-up
  // members and invited guests.
  const { data: checkins } = await supabase
    .from("event_checkins")
    .select(
      "id, name, email, kind, inviter_name, registration_id, member_id, invited_by_registration_id, created_at"
    )
    .eq("event_id", id)
    .order("created_at", { ascending: true });

  const checkedInRegIds = new Set(
    (checkins ?? [])
      .filter((c) => c.registration_id)
      .map((c) => c.registration_id as string)
  );

  const attendees = (registrations ?? []).map((r) => ({
    ...r,
    checkedIn: checkedInRegIds.has(r.id),
  }));

  const total = (registrations ?? []).reduce((acc, a) => acc + a.quantity, 0);
  const seatCap = event.seat_cap as number | null;
  const hasSeatCap = seatCap !== null && seatCap !== undefined;
  const overbooked = hasSeatCap && total > seatCap;

  const { data: waitlist } = hasSeatCap
    ? await supabase
        .from("event_waitlist")
        .select("id, name, email, created_at")
        .eq("event_id", id)
        .order("created_at", { ascending: true })
    : { data: [] };

  // Per-event extra reminder schedule, edited from the Messaging tab.
  const reminderSchedule =
    validateReminderSchedule(event.reminder_schedule).value ?? [];

  // Event comms log: reminders already sent + ad-hoc messages sent from this tab.
  const reminders = await getEventReminderSummary(id);
  const { data: sentMessages } = await supabase
    .from("broadcasts")
    .select("id, subject, body_html, kind, recipient_count, error_count, status, sent_at, created_at")
    .eq("event_id", id)
    .order("created_at", { ascending: false });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const checkInPath = `/public/events/${id}/check-in`;

  return (
    <div>
      <Link
        href="/admin/events"
        className="inline-flex items-center gap-1 text-sm font-body text-muted-foreground hover:text-marine transition-colors mb-4"
      >
        ← Back to Events
      </Link>

      <div className="mb-6">
        <p className="font-accent text-xs tracking-[0.3em] uppercase text-sky-dark mb-1">
          Manage Event
        </p>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-marine">
          {event.title}
        </h1>
      </div>

      <ManageEventTabs
        eventId={id}
        attendees={attendees}
        checkins={checkins ?? []}
        waitlist={waitlist ?? []}
        hasSeatCap={hasSeatCap}
        total={total}
        seatCap={seatCap}
        overbooked={overbooked}
        csvHref={`/api/admin/events/${id}/attendees?format=csv`}
        baseUrl={baseUrl}
        checkInPath={checkInPath}
        strictCheckin={Boolean(event.strict_checkin)}
        reminders={reminders}
        sentMessages={sentMessages ?? []}
        reminderSchedule={reminderSchedule}
        visibility={(event.visibility as string) ?? "members_only"}
        inviteCode={(event.invite_code as string | null) ?? null}
        invitePrice={(event.invite_price as number | null) ?? null}
        registrationEnabled={Boolean(event.registration_enabled)}
      />
    </div>
  );
}
