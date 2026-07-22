import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

// Grouped household delivery (U12). At checkout, guests who were booked to the SAME email
// address (a couple, a family) get ONE email carrying all their QR codes plus a single
// link to manage them, instead of a separate email per guest. Replaces the per-guest QR
// fan-out in event-registration.ts; ticket-qr.ts stays for one-off corrections/re-sends.
//
// Idempotent per ticket (tickets.qr_email_sent_at): a group is sent only if at least one of
// its tickets hasn't been emailed yet, and every ticket in the group is stamped on success.
// Best-effort — a send failure never fails the registration and leaves the stamps NULL so
// the group stays eligible for an admin resend.

const TEMPLATE_ALIAS = "event-household-tickets";

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
  return time ? time.slice(0, 5) : null;
}

interface GuestTicketRow {
  id: string;
  name: string | null;
  email: string | null;
  credential_token: string | null;
  manage_token: string | null;
  qr_email_sent_at: string | null;
  created_at: string;
}

interface EventLike {
  title: string;
  start_date: string | null;
  start_time: string | null;
  location: string | null;
}

export interface SendHouseholdResult {
  /** Distinct email groups that needed sending. */
  groups: number;
  /** Groups successfully sent (stamped). */
  sent: number;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Send ONE same-email household its grouped ticket email and stamp every ticket in it.
 * The single source of truth for the household QR email — used by the checkout/webhook
 * fan-out (sendHouseholdTicketEmails) and the admin per-address resend alike, so the two
 * can never render a different email. Returns true only when the send succeeded (a stamp
 * failure is logged but does not fail the send — the email already went out).
 */
async function deliverHouseholdGroup(params: {
  supabase: AdminClient;
  event: EventLike;
  bookerName: string;
  referenceCode: string | null;
  tickets: GuestTicketRow[];
  logScope: Record<string, unknown>;
}): Promise<boolean> {
  const { supabase, event, bookerName, referenceCode, tickets, logScope } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Stable order (mint order) so the QR blocks read consistently.
  const ordered = tickets
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const to = (ordered[0].email as string).trim();

  // The inviter, unless the booker is themselves in this group (avoid "from yourself").
  const groupNames = new Set(
    ordered.map((t) => (t.name ?? "").trim().toLowerCase()).filter(Boolean)
  );
  const inviterName = bookerName && !groupNames.has(bookerName.toLowerCase()) ? bookerName : null;

  // One manage link opens the whole household (any member's manage_token resolves it).
  const manageToken = ordered.find((t) => t.manage_token)?.manage_token ?? null;
  const multiple = ordered.length > 1 ? true : null;

  const result = await sendEmail({
    to,
    templateAlias: TEMPLATE_ALIAS,
    templateModel: {
      inviter_name: inviterName,
      multiple,
      event_title: event.title,
      event_date_label: formatDate(event.start_date),
      event_time: formatTime(event.start_time),
      event_location: event.location || null,
      reference_code: referenceCode || null,
      manage_url: manageToken ? `${appUrl}/public/tickets/${manageToken}` : null,
      tickets: ordered.map((t) => ({
        name: (t.name as string | null)?.trim() || null,
        qr_url: `${appUrl}/api/qr/${t.credential_token as string}`,
      })),
      preheader: `Your QR code${multiple ? "s" : ""} for ${event.title} — show at the door to get in.`,
    },
  });

  if (!result.success) {
    console.error("[household-tickets] sendEmail failed", { ...logScope, to, err: result.error });
    return false; // leave qr_email_sent_at NULL → eligible for retry
  }

  // Stamp every ticket in the group so a re-run (webhook replay, resend) won't double-send.
  const ids = ordered.map((t) => t.id);
  const { error: stampErr } = await supabase
    .from("tickets")
    .update({ qr_email_sent_at: new Date().toISOString() })
    .in("id", ids);
  if (stampErr) {
    console.error("[household-tickets] failed to stamp qr_email_sent_at", { ...logScope, err: stampErr });
  }
  return true;
}

/**
 * Send each same-email household in a registration one grouped ticket email. Best-effort;
 * callers fire-and-forget. Returns counts for tests/logging.
 */
export async function sendHouseholdTicketEmails(
  registrationId: string
): Promise<SendHouseholdResult> {
  const supabase = createAdminClient();

  const { data: reg } = await supabase
    .from("event_registrations")
    .select("id, event_id, name, reference_code")
    .eq("id", registrationId)
    .limit(1)
    .maybeSingle();
  if (!reg) return { groups: 0, sent: 0 };

  const { data: event } = await supabase
    .from("events")
    .select("title, start_date, start_time, location")
    .eq("id", reg.event_id as string)
    .limit(1)
    .maybeSingle();
  if (!event) return { groups: 0, sent: 0 };

  // The guest set: claimed, live, non-lead (the lead's own QR rides the confirmation email).
  const { data: rows, error } = await supabase
    .from("tickets")
    .select("id, name, email, credential_token, manage_token, qr_email_sent_at, created_at")
    .eq("registration_id", registrationId)
    .eq("is_lead", false)
    .eq("slot_status", "claimed")
    .is("released_at", null);
  if (error) {
    // supabase-js returns { data: null, error } on failure (no throw) — logging it keeps a
    // DB error distinguishable from "no guests" so the party's QRs aren't silently dropped.
    console.error("[household-tickets] guest ticket lookup failed", { registrationId, err: error });
    return { groups: 0, sent: 0 };
  }

  const guests = ((rows ?? []) as GuestTicketRow[]).filter(
    (t) => (t.email ?? "").trim() && t.credential_token
  );

  // Group by lowercased email (the household key).
  const groups = new Map<string, GuestTicketRow[]>();
  for (const t of guests) {
    const key = (t.email as string).trim().toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const bookerName = ((reg.name as string | null) ?? "").trim();
  let sent = 0;
  let needing = 0;

  for (const [, list] of groups) {
    // Idempotent: skip a group where every ticket has already been emailed.
    if (list.every((t) => t.qr_email_sent_at)) continue;
    needing += 1;

    // One bad group must not abort the rest of the run (the old fan-out isolated each
    // guest via Promise.allSettled). A throw here leaves this group unstamped → retry-eligible.
    try {
      const ok = await deliverHouseholdGroup({
        supabase,
        event: event as EventLike,
        bookerName,
        referenceCode: (reg.reference_code as string | null) ?? null,
        tickets: list,
        logScope: { registrationId },
      });
      if (ok) sent += 1;
    } catch (err) {
      console.error("[household-tickets] group send failed", { registrationId, err });
    }
  }

  return { groups: needing, sent };
}

interface ResendTicketRow extends GuestTicketRow {
  registration_id: string | null;
}

/**
 * Admin per-address resend (U15). Re-send the grouped ticket email to a single address for
 * one event — every live, claimed, credentialled ticket at that email (the buyer's own
 * included, unlike the checkout fan-out), as one email with all their QRs. Unconditional:
 * unlike the checkout path it re-sends even already-stamped tickets, because an admin
 * clicking Resend wants the email to go out again. Returns whether the address was emailed.
 *
 * `email` is matched case-insensitively; the on-screen roster groups by lowercased email, so
 * the address the admin sees is the address that gets the resend.
 */
export async function resendHouseholdForAddress(
  eventId: string,
  email: string
): Promise<{ found: boolean; sent: boolean }> {
  const supabase = createAdminClient();
  const wanted = email.trim().toLowerCase();
  if (!wanted) return { found: false, sent: false };

  const { data: event } = await supabase
    .from("events")
    .select("title, start_date, start_time, location")
    .eq("id", eventId)
    .limit(1)
    .maybeSingle();
  if (!event) return { found: false, sent: false };

  // Every live claimed ticket for this event, filtered to the wanted address below. Matching
  // in code (not a DB ilike) keeps the household key — lowercased, trimmed email — identical
  // to the roster's grouping and the checkout fan-out's, so all three agree on what one
  // "address" is.
  const { data: rows, error } = await supabase
    .from("tickets")
    .select(
      "id, name, email, credential_token, manage_token, qr_email_sent_at, created_at, registration_id"
    )
    .eq("event_id", eventId)
    .eq("slot_status", "claimed")
    .is("released_at", null);
  if (error) {
    console.error("[household-tickets] resend ticket lookup failed", { eventId, err: error });
    return { found: false, sent: false };
  }

  const group = ((rows ?? []) as ResendTicketRow[]).filter(
    (t) => (t.email ?? "").trim().toLowerCase() === wanted && t.credential_token
  );
  if (group.length === 0) return { found: false, sent: false };

  // The booker/reference for the inviter line and the receipt reference — from the earliest
  // ticket's registration. An address almost always sits in one booking; if it spans several,
  // the earliest one names the email, which is the same choice the confirmation email made.
  const ordered = group
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const regId = ordered.find((t) => t.registration_id)?.registration_id ?? null;
  let bookerName = "";
  let referenceCode: string | null = null;
  if (regId) {
    const { data: reg } = await supabase
      .from("event_registrations")
      .select("name, reference_code")
      .eq("id", regId)
      .limit(1)
      .maybeSingle();
    bookerName = ((reg?.name as string | null) ?? "").trim();
    referenceCode = (reg?.reference_code as string | null) ?? null;
  }

  const sent = await deliverHouseholdGroup({
    supabase,
    event: event as EventLike,
    bookerName,
    referenceCode,
    tickets: group,
    logScope: { eventId, email: wanted },
  });
  return { found: true, sent };
}
