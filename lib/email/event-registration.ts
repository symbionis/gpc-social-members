import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

const TEMPLATE_ALIAS = "event-registration-confirmed";

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
  // start_time is stored as "HH:MM:SS" — return "HH:MM"
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

export async function sendEventRegistrationConfirmation(
  registrationId: string
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
      "[event-registration-email] registration not found",
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
      "[event-registration-email] event not found",
      registration.event_id,
      evErr
    );
    return { success: false, error: evErr || "event not found" };
  }

  const isFree = registration.status === "free" || Number(registration.total_amount_chf) === 0;
  const amountLabel = formatAmount(Number(registration.total_amount_chf), isFree);

  // Per-type breakdown. Render as a Mustachio section in the template:
  //   {{#ticket_lines}} {{title}} × {{quantity}} — {{line_label}} {{/ticket_lines}}
  const { data: items } = await supabase
    .from("event_registration_items")
    .select("title_snapshot, quantity, line_total_chf")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: true });

  const ticketLines =
    items && items.length > 0
      ? items.map((i) => ({
          title: i.title_snapshot,
          quantity: i.quantity,
          line_label:
            Number(i.line_total_chf) === 0 ? "Free" : `CHF ${Number(i.line_total_chf).toFixed(2)}`,
        }))
      : // Itemless fallback (legacy rows, or deploy-window pending→paid rows the
        // webhook promoted without items): synthesize one line so the breakdown
        // is never blank.
        [{ title: "Registration", quantity: registration.quantity, line_label: amountLabel }];

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
      ticket_lines: ticketLines,
      amount_label: amountLabel,
      reference_code: registration.reference_code,
      is_free: isFree,
      event_url: eventUrl,
      preheader: `You're registered for ${event.title}. Reference ${registration.reference_code}.`,
    },
  });

  if (!result.success) {
    console.error(
      "[event-registration-email] sendEmail failed",
      registrationId,
      result.error
    );
  }

  return result;
}
