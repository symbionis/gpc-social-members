import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";

// Cancellation notices (U5). When a holder cancels a ticket (…/cancel, U14), this tells
// both sides what just happened:
//   - the holder gets a confirmation that their ticket is cancelled (R16);
//   - the payer — who may be a different person entirely (they booked a household member
//     in) — gets told a seat they paid for was released, with a refund to follow (R16).
// When payer and holder are the SAME address, only the holder confirmation goes out; a
// second "you released your own seat" email would be a confusing duplicate (R17).
//
// Best-effort and logged, like every other outbound send in this repo (KTD6): the caller
// invokes this AFTER the seat is already released, so a mail failure here can never affect
// the seat release — the only load-bearing effect of a cancellation.

const HOLDER_TEMPLATE_ALIAS = "event-cancellation-holder";
const PAYER_TEMPLATE_ALIAS = "event-cancellation-payer";

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

// Two addresses are "the same" for R17 purposes when they match after trimming and
// case-folding — mirrors the household grouping key used everywhere else in this repo
// (see lib/email/household-tickets.ts).
function normalize(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export interface SendCancellationNoticesResult {
  holderSent: boolean;
  payerSent: boolean;
}

/**
 * Send the holder confirmation and, when applicable, the payer notice for one cancelled
 * ticket. Always attempts the holder email. Sends the distinct payer email whenever the
 * payer's address differs from the holder's (R17).
 *
 * No payment gate: U5 originally skipped free and comp bookings because the payer notice
 * promised a refund, and there is none to promise on a seat that cost nothing. That line was
 * since dropped from the template — it now says only that a seat the payer arranged has been
 * released, which is equally true and equally worth knowing whether or not money changed
 * hands. Gating on payment would suppress an email that no longer claims anything about it.
 *
 * Never throws: every expected failure (missing rows, a Postmark rejection) is logged and
 * folded into the returned `false`s so the caller's cancellation is never put at risk.
 */
export async function sendCancellationNotices(
  ticketId: string
): Promise<SendCancellationNoticesResult> {
  const none: SendCancellationNoticesResult = { holderSent: false, payerSent: false };
  const supabase = createAdminClient();

  const { data: ticket, error: ticketErr } = await supabase
    .from("tickets")
    .select("id, name, email, registration_id")
    .eq("id", ticketId)
    .limit(1)
    .maybeSingle();
  if (ticketErr) {
    console.error("[cancellation-notice] ticket lookup failed", { ticketId, err: ticketErr });
    return none;
  }
  if (!ticket || !ticket.registration_id) {
    console.error("[cancellation-notice] ticket or its registration not found", { ticketId });
    return none;
  }

  const { data: registration, error: regErr } = await supabase
    .from("event_registrations")
    .select("id, name, email, status, event_id, reference_code")
    .eq("id", ticket.registration_id as string)
    .limit(1)
    .maybeSingle();
  if (regErr || !registration) {
    console.error("[cancellation-notice] registration lookup failed", { ticketId, err: regErr });
    return none;
  }

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("title, start_date, start_time, location")
    .eq("id", registration.event_id as string)
    .limit(1)
    .maybeSingle();
  if (evErr || !event) {
    console.error("[cancellation-notice] event lookup failed", { ticketId, err: evErr });
    return none;
  }

  const holderEmail = ((ticket.email as string | null) ?? (registration.email as string | null) ?? "").trim();
  const holderName =
    ((ticket.name as string | null) ?? (registration.name as string | null) ?? "").trim() || null;
  const payerEmail = ((registration.email as string | null) ?? "").trim();
  const payerName = ((registration.name as string | null) ?? "").trim() || null;

  const commonModel = {
    event_title: event.title as string,
    event_date_label: formatDate(event.start_date as string | null),
    event_time: formatTime(event.start_time as string | null),
    event_location: (event.location as string | null) || null,
    reference_code: (registration.reference_code as string | null) ?? null,
  };

  let holderSent = false;
  if (holderEmail) {
    const result = await sendEmail({
      to: holderEmail,
      templateAlias: HOLDER_TEMPLATE_ALIAS,
      templateModel: {
        ...commonModel,
        holder_name: holderName,
        preheader: `Your ticket for ${commonModel.event_title} has been cancelled.`,
      },
    });
    if (result.success) {
      holderSent = true;
    } else {
      console.error("[cancellation-notice] holder send failed", {
        ticketId,
        to: holderEmail,
        err: result.error,
      });
    }
  } else {
    console.error("[cancellation-notice] no holder email on ticket; skipping holder confirmation", {
      ticketId,
    });
  }

  // R17: same address ⇒ the holder confirmation already told them, so one email, not two.
  // That is the only reason to withhold the payer notice — see the payment-gate note in this
  // function's doc comment for why free and comp bookings are no longer excluded.
  const sameAddress = payerEmail !== "" && normalize(payerEmail) === normalize(holderEmail);

  let payerSent = false;
  if (payerEmail && !sameAddress) {
    const result = await sendEmail({
      to: payerEmail,
      templateAlias: PAYER_TEMPLATE_ALIAS,
      templateModel: {
        ...commonModel,
        payer_name: payerName,
        holder_name: holderName,
        preheader: `A seat you booked for ${commonModel.event_title} has been released — a refund will follow.`,
      },
    });
    if (result.success) {
      payerSent = true;
    } else {
      console.error("[cancellation-notice] payer send failed", {
        ticketId,
        to: payerEmail,
        err: result.error,
      });
    }
  }

  return { holderSent, payerSent };
}
