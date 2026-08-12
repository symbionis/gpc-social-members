import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { sendHouseholdTicketEmails } from "@/lib/email/household-tickets";
import {
  buildReceiptLines,
  subtractReceiptItems,
  toReceiptItemRow,
  type RawReceiptItem,
  type ReceiptItemRow,
} from "@/lib/events/receipt-lines";

// The PAYER's receipt (U4 — split from the old combined confirmation). Carries what was paid
// — itemised lines, paid date, reference code, charge reference — and NOTHING that manages a
// ticket: no QR, no manage link (R15/AE9). The payer's own QR now travels on the ticket-email
// path instead — sendHouseholdTicketEmails() below includes the payer's ticket the same way it
// includes every other holder's, so nothing that used to reach the payer via this email is lost.
const TEMPLATE_ALIAS = "event-receipt";

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

function firstNameFrom(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

function priceLabel(chf: number): string {
  return chf === 0 ? "Free" : `CHF ${chf.toFixed(2)}`;
}


/**
 * Which payment this receipt is for (U4). Omitted = the ORIGINAL checkout payment. The
 * webhook is the only caller that knows which payment just happened — the sender has no other
 * way to find out — so it is the only call site that ever passes this.
 */
export type PayingRow = { type: "topup"; id: string } | { type: "conversion"; id: string };

export async function sendEventRegistrationConfirmation(
  registrationId: string,
  opts?: { resend?: boolean; payingRow?: PayingRow }
): Promise<{ success: boolean; error?: unknown }> {
  const supabase = createAdminClient();

  const { data: registration, error: regErr } = await supabase
    .from("event_registrations")
    .select(
      "id, name, email, quantity, total_amount_chf, reference_code, status, event_id, paid_at, stripe_payment_intent_id"
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

  // Scope the receipt to the ONE payment it's receipting (KTD3). `event_registration_items`
  // accumulates rows across the original checkout AND every later buy-more/conversion, so
  // rendering the whole table per receipt would merge multiple payments into one list.
  let scopedItems: ReceiptItemRow[] = [];
  let totalChf = 0;
  let paidAtIso: string | null = registration.paid_at as string | null;
  let chargeReference: string | null = registration.stripe_payment_intent_id as string | null;

  if (!opts?.payingRow) {
    // Original payment: current item lines minus every applied buy-more's own contribution.
    // A conversion mutates existing lines in place rather than adding a separately-attributable
    // row, so it is not (and cannot be) subtracted out here — it shows up folded into whichever
    // type it left behind, which is correct for "what the booking currently looks like" but not
    // for "what this specific payment bought" if a conversion has happened since. That gap is a
    // known limitation of the original-payment receipt, not of the topup/conversion receipts.
    const { data: items, error: itemsErr } = await supabase
      .from("event_registration_items")
      .select("ticket_type_id, title_snapshot, quantity, unit_amount_chf, line_total_chf")
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: true });
    if (itemsErr) {
      console.error("[event-registration-email] items lookup failed", { registrationId, err: itemsErr });
    }

    const { data: topups, error: topupsErr } = await supabase
      .from("event_registration_topups")
      .select("items")
      .eq("registration_id", registrationId)
      .eq("status", "applied");
    if (topupsErr) {
      console.error("[event-registration-email] topups lookup failed", { registrationId, err: topupsErr });
    }

    const allRows: ReceiptItemRow[] = (items ?? []).map((i) => toReceiptItemRow(i as RawReceiptItem, "orig"));
    const contributed: ReceiptItemRow[][] = (topups ?? []).map((t) =>
      ((t.items as RawReceiptItem[] | null) ?? []).map((i) => toReceiptItemRow(i, "orig"))
    );
    scopedItems = allRows.length > 0 ? subtractReceiptItems(allRows, contributed) : [];

    if (scopedItems.length > 0) {
      totalChf = Number(scopedItems.reduce((s, r) => s + r.lineTotalChf, 0).toFixed(2));
    } else {
      // Itemless fallback (legacy rows, or a deploy-window pending→paid row the webhook
      // promoted without items): synthesize one line so the receipt is never blank.
      totalChf = Number(registration.total_amount_chf);
      scopedItems = [
        {
          ticketTypeId: "fallback",
          title: "Registration",
          quantity: registration.quantity as number,
          unitAmountChf: registration.quantity ? totalChf / (registration.quantity as number) : totalChf,
          lineTotalChf: totalChf,
        },
      ];
    }
  } else if (opts.payingRow.type === "topup") {
    const { data: topup, error: topupErr } = await supabase
      .from("event_registration_topups")
      .select("items, applied_at, stripe_payment_intent_id")
      .eq("id", opts.payingRow.id)
      .limit(1)
      .maybeSingle();
    if (topupErr || !topup) {
      console.error("[event-registration-email] topup not found", { topupId: opts.payingRow.id, err: topupErr });
      return { success: false, error: topupErr || "topup not found" };
    }
    scopedItems = ((topup.items as RawReceiptItem[] | null) ?? []).map((i) => toReceiptItemRow(i, opts.payingRow!.id));
    totalChf = Number(scopedItems.reduce((s, r) => s + r.lineTotalChf, 0).toFixed(2));
    paidAtIso = (topup.applied_at as string | null) ?? paidAtIso;
    chargeReference = (topup.stripe_payment_intent_id as string | null) ?? null;
  } else {
    // Conversion: a delta charge, not a set of purchased lines — event_registration_items
    // was mutated in place (from-type decremented, to-type incremented), so there is no
    // separately-attributable row to read back. Render the delta as its own single line.
    const { data: conv, error: convErr } = await supabase
      .from("event_ticket_type_conversions")
      .select("delta_chf, applied_at, stripe_payment_intent_id, from_type_id, to_type_id")
      .eq("id", opts.payingRow.id)
      .limit(1)
      .maybeSingle();
    if (convErr || !conv) {
      console.error("[event-registration-email] conversion not found", { conversionId: opts.payingRow.id, err: convErr });
      return { success: false, error: convErr || "conversion not found" };
    }
    const { data: types } = await supabase
      .from("event_ticket_types")
      .select("id, title")
      .in("id", [conv.from_type_id, conv.to_type_id]);
    const titleOf = (id: string) => (types ?? []).find((t) => t.id === id)?.title ?? "Ticket";
    const delta = Number(conv.delta_chf);
    scopedItems = [
      {
        ticketTypeId: opts.payingRow.id,
        title: `Upgrade: ${titleOf(conv.from_type_id as string)} → ${titleOf(conv.to_type_id as string)}`,
        quantity: 1,
        unitAmountChf: delta,
        lineTotalChf: delta,
      },
    ];
    totalChf = delta;
    paidAtIso = (conv.applied_at as string | null) ?? paidAtIso;
    chargeReference = (conv.stripe_payment_intent_id as string | null) ?? null;
  }

  const receiptLines = buildReceiptLines(scopedItems);
  const isFree = totalChf === 0;
  const amountLabel = priceLabel(totalChf);
  const firstName = firstNameFrom(registration.name) || registration.name;
  const paidDateLabel = formatDate(paidAtIso);

  const result = await sendEmail({
    to: registration.email,
    templateAlias: TEMPLATE_ALIAS,
    templateModel: {
      first_name: firstName,
      event_title: event.title,
      receipt_lines: receiptLines,
      amount_label: amountLabel,
      reference_code: registration.reference_code,
      paid_date_label: paidDateLabel,
      charge_reference: chargeReference,
      is_free: isFree,
      // Resend (existing registrants): a {{#resend}} intro block explains why a second
      // email arrived. false/absent → the block is omitted.
      resend: opts?.resend ?? false,
      preheader: `Your receipt for ${event.title}. Reference ${registration.reference_code}.`,
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

  // The ticket email carries QRs — every holder's, INCLUDING the payer's own (U4: the payer
  // no longer gets their QR via this receipt). Idempotent per ticket (qr_email_sent_at), so a
  // re-fired Stripe webhook or an admin resend won't double-send.
  let householdDelivered = true;
  try {
    const householdResult = await sendHouseholdTicketEmails(registrationId);
    householdDelivered = householdResult.sent >= householdResult.groups;
    if (!householdDelivered) {
      console.error("[event-registration-email] grouped ticket send partially failed", {
        registrationId,
        ...householdResult,
      });
    }
  } catch (err) {
    householdDelivered = false;
    console.error("[event-registration-email] grouped ticket send failed", { registrationId, err });
  }

  // Record the successful send so the admin "not yet notified" filter + bulk resend can skip
  // this row and double-sends are avoided. `ticket_email_sent_at` means the TICKET (QR)
  // delivery, not the receipt above — stamp only once the household ticket send actually
  // succeeded, so a receipt-sent-but-QR-failed registration stays in the retry-eligible set
  // instead of silently falling out of it. Best-effort: a stamp failure doesn't undo a
  // delivered email, so log and continue.
  if (householdDelivered) {
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
  }

  return result;
}
