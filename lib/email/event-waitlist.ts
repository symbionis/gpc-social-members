import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

// Confirmation sent when an admin promotes a waitlisted person to a confirmed
// (comped) registration. Mirrors sendEventRegistrationConfirmation but uses a
// distinct template with the "a spot has freed up" framing.
//
// See docs/plans/2026-05-21-001-feat-waitlist-to-registration-plan.md (U2).
// The Postmark template `event-waitlist-confirmed` (Layout `main-polo-club`)
// must exist; see docs/email-templates/event-waitlist-confirmed.* for the body.

const TEMPLATE_ALIAS = "event-waitlist-confirmed";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
};

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

export async function sendWaitlistConfirmation(
  registrationId: string
): Promise<{ success: boolean; error?: unknown }> {
  const supabase = createAdminClient();

  const { data: registration, error: regErr } = await supabase
    .from("event_registrations")
    .select("id, name, email, quantity, reference_code, event_id")
    .eq("id", registrationId)
    .limit(1)
    .single();

  if (regErr || !registration) {
    console.error(
      "[event-waitlist-email] registration not found",
      registrationId,
      regErr
    );
    return { success: false, error: regErr || "registration not found" };
  }

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, title, start_date, start_time, location, visibility")
    .eq("id", registration.event_id)
    .limit(1)
    .single();

  if (evErr || !event) {
    console.error(
      "[event-waitlist-email] event not found",
      registration.event_id,
      evErr
    );
    return { success: false, error: evErr || "event not found" };
  }

  const eventDateLabel = formatDate(event.start_date);
  const eventTime = formatTime(event.start_time);
  const firstName = firstNameFrom(registration.name) || registration.name;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const eventUrl =
    event.visibility === "public"
      ? `${appUrl}/public/events/${event.id}`
      : `${appUrl}/events/${event.id}`;

  const result = await sendEmail({
    to: registration.email,
    templateAlias: TEMPLATE_ALIAS,
    templateModel: {
      first_name: firstName,
      event_title: event.title,
      event_date_label: eventDateLabel,
      event_time: eventTime,
      event_location: event.location || null,
      quantity: registration.quantity,
      reference_code: registration.reference_code,
      event_url: eventUrl,
      preheader: `Good news — a spot opened up and you're confirmed for ${event.title}.`,
    },
  });

  if (!result.success) {
    console.error(
      "[event-waitlist-email] sendEmail failed",
      registrationId,
      result.error
    );
  }

  return result;
}
