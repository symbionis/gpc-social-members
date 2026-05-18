import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const TEMPLATE_ALIAS = "event-reminder";

export type ReminderSlot = "morning" | "lunch" | "evening";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
};

const WEEKDAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long" };

function formatDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", DATE_FORMAT).format(d);
}

function formatTime(time: string | null | undefined): string | null {
  if (!time) return null;
  return time.slice(0, 5);
}

function firstNameFrom(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

function formatAmount(totalChf: number, isFree: boolean): string {
  if (isFree) return "Free";
  return `CHF ${totalChf.toFixed(2)}`;
}

function weekdayOf(isoDate: string): string | null {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", WEEKDAY_FORMAT).format(d);
}

// "Tomorrow morning", "This evening", "Friday morning" — slot-aware, no clock time.
// The template can compose with event_time_label separately when it needs the exact time.
function buildTimeUntilLabel(
  daysBefore: number,
  slot: ReminderSlot,
  eventStartDate: string
): string {
  if (daysBefore === 0) return `This ${slot}`;
  if (daysBefore === 1) return `Tomorrow ${slot}`;
  const weekday = weekdayOf(eventStartDate);
  return weekday ? `${weekday} ${slot}` : `In ${daysBefore} days, ${slot}`;
}

function buildMotivationLabel(daysBefore: number): string {
  if (daysBefore === 0) return "Today!";
  if (daysBefore === 1) return "Tomorrow!";
  if (daysBefore <= 3) return "Coming up";
  return "Save the date";
}

export interface SendEventReminderOverrides {
  to_email?: string;
  to_name?: string;
}

/**
 * Send a single event reminder. Pure function callable from cron and the
 * admin test-send route. Never throws — returns { success, error } so the
 * caller can decide whether to record idempotency.
 */
export async function sendEventReminder(
  registrationId: string,
  eventId: string,
  daysBefore: number,
  slot: ReminderSlot,
  overrides?: SendEventReminderOverrides
): Promise<{ success: boolean; error?: unknown }> {
  const supabase = createAdminClient();

  const { data: registration, error: regErr } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, quantity, total_amount_chf, reference_code, status, event_id"
    )
    .eq("id", registrationId)
    .limit(1)
    .single();

  if (regErr || !registration) {
    console.error(
      "[event-reminder-email] registration not found",
      registrationId,
      regErr
    );
    return { success: false, error: regErr || "registration not found" };
  }

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, title, start_date, start_time, location, visibility")
    .eq("id", eventId)
    .limit(1)
    .single();

  if (evErr || !event) {
    console.error(
      "[event-reminder-email] event not found",
      eventId,
      evErr
    );
    return { success: false, error: evErr || "event not found" };
  }

  const toEmail = overrides?.to_email || registration.email;
  const toName = overrides?.to_name || registration.name;

  const isFree =
    registration.status === "free" || Number(registration.total_amount_chf) === 0;
  const amountLabel = formatAmount(Number(registration.total_amount_chf), isFree);
  const eventDateLabel = formatDate(event.start_date);
  const eventTimeLabel = formatTime(event.start_time);

  const timeUntilLabel = buildTimeUntilLabel(daysBefore, slot, event.start_date);
  const motivationLabel = buildMotivationLabel(daysBefore);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const eventUrl =
    event.visibility === "public"
      ? `${appUrl}/public/events/${event.id}`
      : `${appUrl}/events/${event.id}`;

  const result = await sendEmail({
    to: toEmail,
    templateAlias: TEMPLATE_ALIAS,
    templateModel: {
      first_name: firstNameFrom(toName) || toName,
      event_title: event.title,
      event_date_label: eventDateLabel,
      event_time_label: eventTimeLabel,
      event_location: event.location || null,
      time_until_label: timeUntilLabel,
      motivation_label: motivationLabel,
      slot,
      days_before: daysBefore,
      quantity: registration.quantity,
      amount_label: amountLabel,
      reference_code: registration.reference_code,
      is_free: isFree,
      event_url: eventUrl,
      preheader: `${motivationLabel} ${event.title} — ${timeUntilLabel}.`,
    },
  });

  if (!result.success) {
    console.error(
      "[event-reminder-email] sendEmail failed",
      registrationId,
      eventId,
      daysBefore,
      slot,
      result.error
    );
  }

  return result;
}
