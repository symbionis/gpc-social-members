import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

// Guest entry-QR email ("no QR, no bracelet"). When a guest is named WITH an email —
// at checkout (via the booking confirmation) or on the self-registration link — we send
// that person their own QR code so they can get in on their own. Distinct from the
// lead's whole-booking confirmation (event-registration-confirmed): this is one ticket,
// one QR, addressed to the guest. Idempotent per ticket via tickets.qr_email_sent_at, so
// a re-run (e.g. a Stripe webhook that fires the confirmation twice) never double-sends.

const TEMPLATE_ALIAS = "event-ticket";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
};

function formatDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("en-GB", DATE_FORMAT).format(d);
}

function formatTime(time: string | null | undefined): string | null {
  // start_time is stored as "HH:MM:SS" — return "HH:MM".
  return time ? time.slice(0, 5) : null;
}

function firstNameFrom(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "";
}

export interface SendTicketQrResult {
  success: boolean;
  /** Set when the send was intentionally skipped (not an error) — e.g. no email. */
  skipped?:
    | "released"
    | "no_email"
    | "no_credential"
    | "already_sent"
    | "no_event"
    | "not_found";
  error?: unknown;
}

/**
 * Email one guest their own entry QR. Best-effort and idempotent: it only sends when the
 * ticket is live, has an email, and hasn't already been sent (qr_email_sent_at). Every
 * ticket now carries an email (R8) — no more name-only child exemption. Callers
 * fire-and-forget — the return value is for tests/logging.
 */
export async function sendTicketQrEmail(ticketId: string): Promise<SendTicketQrResult> {
  const supabase = createAdminClient();

  const { data: ticket, error } = await supabase
    .from("tickets")
    .select(
      "id, event_id, registration_id, name, email, released_at, credential_token, qr_email_sent_at"
    )
    .eq("id", ticketId)
    .limit(1)
    .maybeSingle();
  if (error || !ticket) return { success: false, skipped: "not_found", error };
  if (ticket.released_at) return { success: false, skipped: "released" };
  if (!ticket.email) return { success: false, skipped: "no_email" };
  if (!ticket.credential_token) return { success: false, skipped: "no_credential" };
  if (ticket.qr_email_sent_at) return { success: false, skipped: "already_sent" };

  const { data: event } = await supabase
    .from("events")
    .select("title, start_date, start_time, location")
    .eq("id", ticket.event_id)
    .limit(1)
    .maybeSingle();
  if (!event) return { success: false, skipped: "no_event" };

  const guestName = (ticket.name as string | null)?.trim() || null;

  // Booking reference (best-effort) — handy for the guest and door staff on a lost-QR.
  // The registration's `name` is the booker/inviter, so the guest sees who invited them.
  let referenceCode: string | null = null;
  let inviterName: string | null = null;
  if (ticket.registration_id) {
    const { data: reg } = await supabase
      .from("event_registrations")
      .select("reference_code, name")
      .eq("id", ticket.registration_id)
      .limit(1)
      .maybeSingle();
    referenceCode = (reg?.reference_code as string | null) ?? null;
    const booker = ((reg?.name as string | null) ?? "").trim();
    // Only name the inviter when it's someone other than this guest (a lead who named
    // themselves as a guest slot would otherwise be "invited by <themselves>").
    if (booker && booker.toLowerCase() !== (guestName ?? "").toLowerCase()) {
      inviterName = booker;
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const result = await sendEmail({
    to: ticket.email as string,
    templateAlias: TEMPLATE_ALIAS,
    templateModel: {
      // first_name for the greeting; null (not "") so the Mustachio block is omitted.
      first_name: guestName ? firstNameFrom(guestName) : null,
      guest_name: guestName,
      // The lead booker who invited this guest; null (not "") omits the block.
      inviter_name: inviterName,
      event_title: event.title,
      event_date_label: formatDate(event.start_date as string),
      event_time: formatTime(event.start_time as string),
      event_location: (event.location as string | null) || null,
      reference_code: referenceCode,
      // Hosted QR image — qrcode.react can't run in email. /api/qr/<token> renders the PNG.
      qr_url: `${appUrl}/api/qr/${ticket.credential_token as string}`,
      preheader: `Your QR code for ${event.title} — show it at the door to get in.`,
    },
  });
  if (!result.success) {
    console.error("[ticket-qr-email] sendEmail failed", { ticketId, err: result.error });
    return result;
  }

  // Stamp only on success — a failed send stays NULL so it's still eligible for a retry.
  const { error: stampErr } = await supabase
    .from("tickets")
    .update({ qr_email_sent_at: new Date().toISOString() })
    .eq("id", ticketId);
  if (stampErr) {
    console.error("[ticket-qr-email] failed to stamp qr_email_sent_at", { ticketId, err: stampErr });
  }

  return { success: true };
}
