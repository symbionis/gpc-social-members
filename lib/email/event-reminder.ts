import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import {
  formatDateWithWeekday,
  formatStartTime,
  formatWeekday,
} from "@/lib/format";

const TEMPLATE_ALIAS = "event-reminder";

export type ReminderSlot = "morning" | "lunch" | "evening";

function firstNameFrom(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

function formatAmount(totalChf: number, isFree: boolean): string {
  if (isFree) return "Free";
  return `CHF ${totalChf.toFixed(2)}`;
}

// Map an event's wall-clock start time to a time-of-day word for the copy.
// 08:00 → "morning", 13:00 → "afternoon", 17:30 → "evening". Returns null
// when the event has no start time so the copy falls back to date-only.
// IMPORTANT: this is the EVENT's time of day — never the reminder send slot.
// The send slot (morning/lunch/evening) only controls *when the email goes
// out*; using it to describe the event mislabels a 17:30 event reminded at
// 08:00 as "Tomorrow morning".
function eventTimeOfDay(
  startTime: string | null | undefined
): "morning" | "afternoon" | "evening" | null {
  if (!startTime) return null;
  const hour = Number(startTime.slice(0, 2));
  if (Number.isNaN(hour)) return null;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

// "Tomorrow evening", "This evening", "Friday morning" — time-of-day derived
// from the event's own start time, no clock time. The template composes with
// event_time_label separately when it needs the exact time.
function buildTimeUntilLabel(
  daysBefore: number,
  eventStartDate: string,
  eventStartTime: string | null | undefined
): string {
  const tod = eventTimeOfDay(eventStartTime);
  const suffix = tod ? ` ${tod}` : "";
  if (daysBefore === 0) return tod ? `This ${tod}` : "Today";
  if (daysBefore === 1) return `Tomorrow${suffix}`;
  const weekday = formatWeekday(eventStartDate);
  if (weekday) return `${weekday}${suffix}`;
  return `In ${daysBefore} days${suffix}`;
}

function buildMotivationLabel(daysBefore: number): string {
  if (daysBefore === 0) return "Today!";
  if (daysBefore === 1) return "Tomorrow!";
  if (daysBefore <= 3) return "Coming up";
  return "Save the date";
}

interface SyntheticRegistration {
  name: string;
  email: string;
  quantity: number;
  total_amount_chf: number;
  reference_code: string;
  status: string;
}

export interface SendEventReminderOverrides {
  to_email?: string;
  to_name?: string;
  // When provided, skip the DB load and use this in place of the registration
  // row. Used by the admin test-send route to preview without requiring a
  // real seed registration on the event.
  synthetic_registration?: SyntheticRegistration;
}

/**
 * Send a single event reminder. Pure function callable from cron and the
 * admin test-send route. Never throws — returns { success, error } so the
 * caller can decide whether to record idempotency.
 *
 * Pass `registrationId = null` together with `overrides.synthetic_registration`
 * to send without touching the event_registrations table (test-send path).
 */
export async function sendEventReminder(
  registrationId: string | null,
  eventId: string,
  daysBefore: number,
  slot: ReminderSlot,
  overrides?: SendEventReminderOverrides
): Promise<{ success: boolean; error?: unknown }> {
  const supabase = createAdminClient();

  let registration: SyntheticRegistration;
  if (overrides?.synthetic_registration) {
    registration = overrides.synthetic_registration;
  } else if (registrationId) {
    const { data, error: regErr } = await supabase
      .from("event_registrations")
      .select(
        "id, name, email, quantity, total_amount_chf, reference_code, status, event_id"
      )
      .eq("id", registrationId)
      .limit(1)
      .maybeSingle();

    if (regErr) {
      console.error("[event-reminder-email] registration lookup failed", registrationId, regErr);
      return { success: false, error: regErr };
    }
    if (!data) {
      console.warn("[event-reminder-email] registration not found", registrationId);
      return { success: false, error: "registration not found" };
    }
    registration = {
      name: data.name,
      email: data.email,
      quantity: data.quantity,
      total_amount_chf: Number(data.total_amount_chf),
      reference_code: data.reference_code,
      status: data.status,
    };
  } else {
    return {
      success: false,
      error: "registrationId or synthetic_registration is required",
    };
  }

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, title, start_date, start_time, location, visibility")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();

  if (evErr) {
    console.error("[event-reminder-email] event lookup failed", eventId, evErr);
    return { success: false, error: evErr };
  }
  if (!event) {
    console.warn("[event-reminder-email] event not found", eventId);
    return { success: false, error: "event not found" };
  }

  const toEmail = overrides?.to_email || registration.email;
  const toName = overrides?.to_name || registration.name;

  const isFree =
    registration.status === "free" || Number(registration.total_amount_chf) === 0;
  const amountLabel = formatAmount(Number(registration.total_amount_chf), isFree);
  const eventDateLabel = formatDateWithWeekday(event.start_date);
  const eventTimeLabel = formatStartTime(event.start_time);

  const timeUntilLabel = buildTimeUntilLabel(daysBefore, event.start_date, event.start_time);
  const motivationLabel = buildMotivationLabel(daysBefore);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    // Production reminders without an app URL would ship unclickable localhost
    // links — refuse to send and let the caller surface the misconfig.
    console.error("[event-reminder-email] NEXT_PUBLIC_APP_URL is not set; refusing to send");
    return {
      success: false,
      error: "NEXT_PUBLIC_APP_URL is not set",
    };
  }
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
