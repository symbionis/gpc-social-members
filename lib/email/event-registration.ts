import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { sendTicketQrEmail } from "@/lib/email/ticket-qr";

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
  registrationId: string,
  opts?: { resend?: boolean }
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

  // Per-ticket QR block: ONLY the lead booker's own ticket QR. This is the code they
  // show at the entrance (the familiar "your ticket" behaviour). Guests' QRs aren't in
  // the email — the lead names/shares/forwards those from the booking page (manage_url).
  // Hosted QR image (qrcode.react can't run in email). Mustachio section {{#tickets}}
  // {{label}} {{name}} <img src="{{qr_url}}"> {{/tickets}}; name is null (not "") if unnamed.
  const { data: ticketRows, error: ticketErr } = await supabase
    .from("tickets")
    .select("credential_token, name, is_lead")
    .eq("registration_id", registrationId)
    .eq("is_lead", true)
    .in("slot_status", ["issued", "claimed"])
    .is("released_at", null)
    .order("created_at", { ascending: true });
  // Log distinctly so a real failure isn't disguised as a legitimate empty QR block
  // (the lead can still reach their QR — and every guest's — via manage_url).
  if (ticketErr) {
    console.error("[event-registration-email] tickets lookup failed", { registrationId, err: ticketErr });
  }
  const tickets = (ticketRows ?? [])
    .filter((t) => t.credential_token)
    .map((t) => ({
      label: "Your ticket",
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
      // Resend (existing registrants): a {{#resend}} intro block explains why a
      // second email arrived (the upgrade to QR tickets). false/absent → the block
      // is omitted, so a normal first confirmation is unchanged.
      resend: opts?.resend ?? false,
      preheader: `You're registered for ${event.title}. Reference ${registration.reference_code}.`,
    },
  });

  if (!result.success) {
    console.error(
      "[event-registration-email] sendEmail failed",
      registrationId,
      result.error
    );
    return result;
  }

  // Record the successful send so the admin "not yet notified" filter + bulk resend
  // can skip this row and double-sends are avoided. Stamp ONLY on success — a failed
  // send must leave the row in the not-yet-notified set so it stays eligible for retry.
  // Best-effort: a stamp failure doesn't undo a delivered email, so log and continue.
  const { error: stampErr } = await supabase
    .from("event_registrations")
    .update({ ticket_email_sent_at: new Date().toISOString() })
    .eq("id", registrationId);
  if (stampErr) {
    console.error("[event-registration-email] failed to stamp ticket_email_sent_at", {
      registrationId,
      err: stampErr,
    });
  }

  // Auto-send each NAMED guest their own entry QR ("no QR, no bracelet"), in
  // parallel — each send is independent and best-effort. The lead's confirmation
  // above carries only the lead's QR; guests named at checkout get theirs here. A
  // guest-email failure never affects the lead's email or the registration.
  // Idempotent per ticket (qr_email_sent_at), so a re-fired Stripe webhook or an
  // admin resend won't double-send; it only fills gaps.
  try {
    const { data: guestTickets, error: guestErr } = await supabase
      .from("tickets")
      .select("id, email, qr_email_sent_at")
      .eq("registration_id", registrationId)
      .eq("is_lead", false)
      .eq("slot_status", "claimed")
      .is("released_at", null);
    // supabase-js returns { data: null, error } on a query failure — it does not
    // throw — so without this check a DB error would silently become "0 guests need
    // a QR" and drop the whole party's entry codes. Log it so the two are
    // distinguishable (and the row stays eligible for an admin resend).
    if (guestErr) {
      console.error("[event-registration-email] guest ticket lookup failed", {
        registrationId,
        err: guestErr,
      });
    }
    await Promise.allSettled(
      (guestTickets ?? [])
        .filter((g) => g.email && !g.qr_email_sent_at)
        .map((g) =>
          sendTicketQrEmail(g.id as string).catch((err) =>
            console.error("[event-registration-email] guest QR send failed", {
              ticketId: g.id,
              err,
            })
          )
        ),
    );
  } catch (err) {
    console.error("[event-registration-email] guest QR batch failed", { registrationId, err });
  }

  return result;
}
