import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { formatDateWithWeekday, formatStartTime } from "@/lib/format";

// Sent when an admin offers a waitlisted person a seat to buy (U3). Unlike the
// retired comp-conversion email (lib/email/event-waitlist.ts), this is not a
// confirmation — the recipient still has to open the link and pay. The seat
// is not held, so the copy must say so plainly, and a members-only event must
// tell the reader to sign in first (R9, R11).
//
// See docs/plans/2026-08-11-001-feat-waitlist-paid-offer-flow-plan.md (U3).
// The Postmark template `event-waitlist-offer` (Layout `main-polo-club`) must
// exist; see docs/email-templates/event-waitlist-offer.* for the body.

const TEMPLATE_ALIAS = "event-waitlist-offer";

function firstNameFrom(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

/**
 * Send (or resend) the offer email for a waitlist entry.
 *
 * Returns { success, error } rather than throwing on any EXPECTED failure —
 * a missing entry, a missing token, a misconfigured app URL, a Postmark
 * rejection — so the caller can surface it without losing the offer state
 * already persisted on the entry. It is not a no-throw guarantee: it reads
 * from Supabase, and createAdminClient() throws outright when its env is
 * unset, which is why the caller still wraps this in a try/catch.
 *
 * The entry must already carry an `offer_token` (minted by the caller before
 * calling this) — sending without one would ship a link to nowhere.
 */
export async function sendWaitlistOffer(
  waitlistEntryId: string
): Promise<{ success: boolean; error?: unknown }> {
  const supabase = createAdminClient();

  const { data: entry, error: entryErr } = await supabase
    .from("event_waitlist")
    .select(
      "id, name, email, quantity, offer_token, event_id, ticket_type_id"
    )
    .eq("id", waitlistEntryId)
    .limit(1)
    .maybeSingle();

  if (entryErr) {
    console.error(
      "[event-waitlist-offer-email] entry lookup failed",
      waitlistEntryId,
      entryErr
    );
    return { success: false, error: entryErr };
  }
  if (!entry) {
    console.warn("[event-waitlist-offer-email] entry not found", waitlistEntryId);
    return { success: false, error: "entry not found" };
  }
  if (!entry.offer_token) {
    console.error(
      "[event-waitlist-offer-email] entry has no offer_token; refusing to send a link to nowhere",
      waitlistEntryId
    );
    return { success: false, error: "entry has no offer_token" };
  }

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, title, start_date, start_time, location, visibility")
    .eq("id", entry.event_id)
    .limit(1)
    .maybeSingle();

  if (evErr) {
    console.error(
      "[event-waitlist-offer-email] event lookup failed",
      entry.event_id,
      evErr
    );
    return { success: false, error: evErr };
  }
  if (!event) {
    console.warn(
      "[event-waitlist-offer-email] event not found",
      entry.event_id
    );
    return { success: false, error: "event not found" };
  }

  let ticketTypeTitle: string | null = null;
  if (entry.ticket_type_id) {
    const { data: ticketType, error: typeErr } = await supabase
      .from("event_ticket_types")
      .select("title")
      .eq("id", entry.ticket_type_id)
      .limit(1)
      .maybeSingle();
    if (typeErr) {
      console.error(
        "[event-waitlist-offer-email] ticket type lookup failed",
        entry.ticket_type_id,
        typeErr
      );
      return { success: false, error: typeErr };
    }
    ticketTypeTitle = ticketType?.title ?? null;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    // Production offers without an app URL would ship an unclickable
    // localhost link — refuse to send and let the caller surface the misconfig.
    console.error(
      "[event-waitlist-offer-email] NEXT_PUBLIC_APP_URL is not set; refusing to send"
    );
    return {
      success: false,
      error: "NEXT_PUBLIC_APP_URL is not set",
    };
  }
  const offerUrl = `${appUrl}/public/offers/${entry.offer_token}`;

  const firstName = firstNameFrom(entry.name) || entry.name;
  const eventDateLabel = formatDateWithWeekday(event.start_date);
  const eventTimeLabel = formatStartTime(event.start_time);
  const isMembersOnly = event.visibility !== "public";

  const result = await sendEmail({
    to: entry.email,
    templateAlias: TEMPLATE_ALIAS,
    templateModel: {
      first_name: firstName,
      event_title: event.title,
      event_date_label: eventDateLabel,
      event_time_label: eventTimeLabel,
      event_location: event.location || null,
      ticket_type_title: ticketTypeTitle,
      quantity: entry.quantity,
      offer_url: offerUrl,
      is_members_only: isMembersOnly,
      preheader: `A seat has opened up for ${event.title} — it's yours if you're first to pay.`,
    },
  });

  if (!result.success) {
    console.error(
      "[event-waitlist-offer-email] sendEmail failed",
      waitlistEntryId,
      result.error
    );
  }

  return result;
}
