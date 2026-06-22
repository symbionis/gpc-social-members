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
      "id, name, email, quantity, total_amount_chf, reference_code, status, event_id, self_reg_token, manage_token"
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
  const { data: items, error: itemsErr } = await supabase
    .from("event_registration_items")
    .select("title_snapshot, quantity, line_total_chf")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: true });

  // Log a query error distinctly so a real failure isn't disguised as the
  // legitimate "itemless legacy row" fallback below (which would email a
  // collapsed single-line breakdown for an order that actually has items).
  if (itemsErr) {
    console.error("[event-registration-email] items lookup failed", { registrationId, err: itemsErr });
  }

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

  // Self-registration link (U9/U10): present only for a party with room for guests
  // (more than the lead's own ticket) and a token on the row. `string | null`, never
  // "" — Postmark/Mustachio renders the share block with {{#self_registration_url}}…
  // {{/self_registration_url}} (no {{#if}}); a null value omits the block.
  const selfRegUrl =
    registration.self_reg_token && registration.quantity > 1
      ? `${appUrl}/public/registrations/${registration.self_reg_token}`
      : null;

  // Lead "My Booking" page (FEAT-41): name/forward tickets, see every QR, buy more.
  // null (never "") so the Mustachio block is omitted when there's no token.
  const manageUrl = registration.manage_token
    ? `${appUrl}/public/bookings/${registration.manage_token}`
    : null;

  // Per-ticket QR block: each live ticket's bearer credential as a hosted QR image
  // (qrcode.react can't run in email). Mustachio section {{#tickets}} {{label}}
  // {{name}} <img src="{{qr_url}}"> {{/tickets}}; name is null (not "") for unnamed.
  const { data: ticketRows } = await supabase
    .from("tickets")
    .select("credential_token, name")
    .eq("registration_id", registrationId)
    .in("slot_status", ["issued", "claimed"])
    .is("released_at", null)
    .order("created_at", { ascending: true });
  const tickets = (ticketRows ?? [])
    .filter((t) => t.credential_token)
    .map((t, i) => ({
      label: `Ticket ${i + 1}`,
      name: (t.name as string | null)?.trim() || null,
      qr_url: `${appUrl}/api/qr/${t.credential_token as string}`,
    }));

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
      // Lead shares this so the rest of their party self-registers (null = solo
      // booking / no token → the template's share block is omitted).
      self_registration_url: selfRegUrl,
      // Lead booking page: name tickets, share each QR, forward batches, buy more.
      manage_url: manageUrl,
      // Per-ticket QR codes (FEAT-41). Empty array → the {{#tickets}} block renders
      // nothing (the lead can still reach every QR via manage_url).
      tickets,
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
