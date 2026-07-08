import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { sendEventRegistrationConfirmation } from "@/lib/email/event-registration";
import { seedLeadAttendee, mintRegistrationTickets } from "@/lib/events/roster";
import { generateCardNumber } from "@/lib/utils/card";
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

async function activateMembership(memberId: string, tierId: string | null) {
  const supabase = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Set membership dates
  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const endDate = new Date(now);
  endDate.setFullYear(endDate.getFullYear() + 1);
  const endDateStr = endDate.toISOString().slice(0, 10);

  // Activate member with dates
  await supabase
    .from("members")
    .update({
      status: "active",
      tier_id: tierId,
      start_date: startDate,
      end_date: endDateStr,
    })
    .eq("id", memberId);

  // Generate digital card — dates derived from member record
  const cardNumber = generateCardNumber();
  const verifyUrl = `${appUrl}/verify/${cardNumber}`;

  const { data: newCards } = await supabase
    .from("membership_cards")
    .insert({
      member_id: memberId,
      card_number: cardNumber,
      qr_code_data: verifyUrl,
      tier_id: tierId,
      valid_from: startDate,
      valid_until: endDateStr,
      is_active: true,
    })
    .select("id")
    .limit(1);

  const newCardId = newCards?.[0]?.id;

  // Deactivate old cards
  if (newCardId) {
    await supabase
      .from("membership_cards")
      .update({ is_active: false })
      .eq("member_id", memberId)
      .neq("id", newCardId)
      .eq("is_active", true);
  }

  // Get member + tier info for email
  const { data: members } = await supabase
    .from("members")
    .select("email, first_name, last_name, tier_id")
    .eq("id", memberId)
    .limit(1);

  if (members?.[0]) {
    const m = members[0];
    let tierName = "Member";
    if (m.tier_id) {
      const { data: tiers } = await supabase
        .from("membership_tiers")
        .select("name")
        .eq("id", m.tier_id)
        .limit(1);
      if (tiers?.[0]) tierName = tiers[0].name;
    }

    await sendEmail({
      to: m.email,
      templateAlias: "member-approved",
      templateModel: {
        first_name: m.first_name,
        last_name: m.last_name,
        tier_name: tierName,
        has_card: true,
        card_number: cardNumber,
        portal_url: `${appUrl}/login`,
        checkout_url: null,
        has_payment: null,
        dashboard_url: null,
        preheader: "Your membership is now active. Welcome to the Geneva Polo Club!",
      },
    }).catch((err) =>
      console.error("[webhook] member-approved email failed:", err)
    );
  }

  return cardNumber;
}

async function notifyCommittee(memberId: string, applicantData: { name: string; email: string; company: string; role: string; note: string | null }) {
  const supabase = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const { data: committee } = await supabase
    .from("admin_users")
    .select("email, first_name")
    .or("is_approval_committee.eq.true,role.eq.super_admin");

  if (!committee?.length) return;

  const adminUrl = `${appUrl}/admin/applications`;

  await Promise.all(
    committee.map((admin) =>
      sendEmail({
        to: admin.email,
        templateAlias: "new-application-pending",
        templateModel: {
          recipient_first_name: admin.first_name,
          applicant_name: applicantData.name,
          applicant_email: applicantData.email,
          applicant_company: applicantData.company || "—",
          applicant_role: applicantData.role || "—",
          originator_note: applicantData.note || null,
          is_reminder: null,
          is_urgent: null,
          days_remaining: null,
          hours_remaining: null,
          admin_url: adminUrl,
          preheader: `New application from ${applicantData.name} is awaiting review.`,
        },
      })
    )
  ).catch((err) =>
    console.error("[webhook] committee notification failed:", err)
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createAdminClient();

  console.log("[webhook]", event.type, event.id);

  switch (event.type) {
    // ===== EXISTING: Checkout Session (renewals + legacy payments) =====
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      // Events branch: route by event_registration_id metadata. Look up by
      // primary key (set in Stripe metadata at session creation) — we cannot
      // depend on stripe_checkout_session_id being persisted yet, since the
      // webhook may race the post-create update.
      const eventRegistrationId = session.metadata?.event_registration_id;
      if (eventRegistrationId) {
        // TOP-UP branch (U6) — MUST run before the paid short-circuit below. A top-up
        // checkout carries the existing (already-'paid') registration id; without this
        // branch the short-circuit would ack it and mint nothing, charging for tickets
        // that never appear. apply_registration_topup is idempotent (keyed on the
        // top-up id), and mint is idempotent, so a webhook replay is safe.
        const topupId =
          session.metadata?.topup === "true" ? session.metadata?.topup_id : undefined;
        if (topupId) {
          const { data: applied, error: applyErr } = await supabase.rpc(
            "apply_registration_topup",
            { p_topup_id: topupId }
          );
          if (applyErr) {
            console.error("[webhook] apply_registration_topup failed — 500 for retry", {
              topupId,
              err: applyErr,
            });
            return NextResponse.json({ error: "Top-up apply failed" }, { status: 500 });
          }
          const topupStatus = (applied as { status?: string } | null)?.status;
          if (topupStatus === "not_found") {
            // Metadata names a top-up row that doesn't exist — the customer was charged
            // but there is nothing to apply, and this is not retryable. Tag the
            // PaymentIntent with a durable, queryable refund signal (mirrors the
            // duplicate-registration path) so the charge can be found after logs rotate.
            console.error(
              "[webhook] top-up id in metadata not found — payment captured, NEEDS MANUAL REFUND/RECONCILIATION",
              { topupId, sessionId: session.id, paymentIntent: session.payment_intent }
            );
            if (typeof session.payment_intent === "string") {
              try {
                await getStripe().paymentIntents.update(session.payment_intent, {
                  metadata: {
                    needs_refund: "topup_not_found",
                    topup_id: topupId,
                    event_session: session.id,
                  },
                });
              } catch (tagErr) {
                console.error("[webhook] failed to tag PaymentIntent for refund", {
                  paymentIntent: session.payment_intent,
                  err: tagErr,
                });
              }
            }
            return NextResponse.json({ received: true });
          }
          // Mint the newly-purchased slots (idempotent — only the shortfall is minted).
          await mintRegistrationTickets(eventRegistrationId);
          // Send an updated confirmation (carries manage_url + every ticket's QR, now
          // including the new ones) so the lead can name/forward them. Best-effort.
          if (topupStatus === "applied") {
            await sendEventRegistrationConfirmation(eventRegistrationId).catch((err) =>
              console.error("[webhook] top-up confirmation email failed", err)
            );
          }
          return NextResponse.json({ received: true, topup: topupStatus });
        }

        // CONVERT branch (U3) — MUST run before the paid short-circuit below, for the same
        // reason as top-up: a conversion checkout carries the existing (already-'paid')
        // registration id. Data-driven on conversion_id presence (KTD3), not a boolean flag
        // that can be set at creation and missing at delivery. apply_ticket_type_conversion
        // is idempotent (keyed on the conversion id), so a webhook replay returns 'already'
        // and mutates nothing. No mint here — the conversion leaves quantity unchanged.
        const conversionId = session.metadata?.conversion_id;
        if (conversionId) {
          const { data: convApplied, error: convErr } = await supabase.rpc(
            "apply_ticket_type_conversion",
            { p_conversion_id: conversionId }
          );
          if (convErr) {
            console.error("[webhook] apply_ticket_type_conversion failed — 500 for retry", {
              conversionId,
              err: convErr,
            });
            return NextResponse.json({ error: "Conversion apply failed" }, { status: 500 });
          }
          const convStatus = (convApplied as { status?: string } | null)?.status;
          if (convStatus === "not_found" || convStatus === "conflict") {
            // The customer was charged but the conversion can't be applied — either the id
            // names a row that doesn't exist, or the ticket changed state (checked-in,
            // released, re-converted) between checkout and webhook. Neither is retryable.
            // Tag the PaymentIntent with a durable, queryable refund signal (mirrors the
            // top-up / duplicate paths) so the charge can be found after logs rotate.
            const reason =
              convStatus === "conflict" ? "conversion_conflict" : "conversion_not_found";
            console.error(
              "[webhook] conversion " + convStatus + " — payment captured, NEEDS MANUAL REFUND/RECONCILIATION",
              { conversionId, sessionId: session.id, paymentIntent: session.payment_intent }
            );
            if (typeof session.payment_intent === "string") {
              try {
                await getStripe().paymentIntents.update(session.payment_intent, {
                  metadata: {
                    needs_refund: reason,
                    conversion_id: conversionId,
                    event_session: session.id,
                  },
                });
              } catch (tagErr) {
                console.error("[webhook] failed to tag PaymentIntent for refund", {
                  paymentIntent: session.payment_intent,
                  err: tagErr,
                });
              }
            }
            return NextResponse.json({ received: true });
          }
          // Applied: re-send the confirmation (updated type/price, same QRs) so the lead
          // has the current booking. 'already' (replay) skips the email. Best-effort.
          if (convStatus === "applied") {
            await sendEventRegistrationConfirmation(eventRegistrationId).catch((err) =>
              console.error("[webhook] conversion confirmation email failed", err)
            );
          }
          return NextResponse.json({ received: true, conversion: convStatus });
        }

        const { data: existing, error: lookupErr } = await supabase
          .from("event_registrations")
          .select("id, status")
          .eq("id", eventRegistrationId)
          .limit(1)
          .maybeSingle();

        if (lookupErr) {
          console.error(
            "[webhook] event registration lookup failed — returning 500 for retry",
            lookupErr
          );
          return NextResponse.json(
            { error: "Registration lookup failed" },
            { status: 500 }
          );
        }

        if (!existing) {
          // Metadata claims a registration that does not exist; not retryable.
          console.error(
            "[webhook] event_registration_id in metadata not found",
            { eventRegistrationId, sessionId: session.id }
          );
          return NextResponse.json({ received: true });
        }

        if (existing.status === "paid") {
          return NextResponse.json({
            received: true,
            already_processed: true,
          });
        }

        const { error: updateErr } = await supabase
          .from("event_registrations")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : null,
          })
          .eq("id", existing.id);

        if (updateErr) {
          // The partial unique index (event_id, lower(email)) WHERE status IN
          // ('paid','free') can reject this promotion if the person was already
          // comped off the waitlist (a 'free' row took the slot) while this paid
          // checkout was in flight. The customer HAS been charged but a
          // registration already exists — do NOT 500-loop on Stripe retries.
          // Acknowledge and flag loudly for manual refund / reconciliation.
          if ((updateErr as { code?: string }).code === "23505") {
            console.error(
              "[webhook] duplicate registration on pending→paid (likely a waitlist comp) — payment captured, NEEDS MANUAL REFUND/RECONCILIATION",
              {
                registrationId: existing.id,
                sessionId: session.id,
                paymentIntent: session.payment_intent,
              }
            );
            // Durable, queryable signal so the charged customer can be found and
            // refunded even after logs rotate — tag the PaymentIntent in Stripe.
            // Best-effort: a tagging failure must not turn this back into a 500.
            if (typeof session.payment_intent === "string") {
              try {
                await getStripe().paymentIntents.update(session.payment_intent, {
                  metadata: {
                    needs_refund: "duplicate_registration",
                    registration_id: existing.id,
                    event_session: session.id,
                  },
                });
              } catch (tagErr) {
                console.error("[webhook] failed to tag PaymentIntent for refund", {
                  paymentIntent: session.payment_intent,
                  err: tagErr,
                });
              }
            }
            return NextResponse.json({ received: true, duplicate_registration: true });
          }
          console.error(
            "[webhook] event registration update failed — returning 500 for retry",
            updateErr
          );
          return NextResponse.json(
            { error: "Registration update failed" },
            { status: 500 }
          );
        }

        // Seed the purchaser onto the roster now that payment is confirmed (U12),
        // then mint a credentialled (QR) ticket for every remaining purchased slot
        // (U2). Both are idempotent, so a webhook replay mints no duplicates.
        await seedLeadAttendee(existing.id);
        await mintRegistrationTickets(existing.id);

        await sendEventRegistrationConfirmation(existing.id).catch((err) =>
          console.error(
            "[webhook] event-registration-confirmed email failed",
            err
          )
        );

        return NextResponse.json({ received: true });
      }

      const memberId = session.metadata?.member_id;

      if (!memberId) {
        console.error("[webhook] No member_id in session metadata");
        return NextResponse.json({ received: true });
      }

      // Idempotency: check if payment already recorded
      const { data: existingPayments } = await supabase
        .from("payments")
        .select("id")
        .eq("stripe_checkout_session_id", session.id)
        .limit(1);

      if (existingPayments && existingPayments.length > 0) {
        return NextResponse.json({ received: true, already_processed: true });
      }

      const isRenewal = session.metadata?.renewal === "true";
      let tierId: string | null = session.metadata?.tier_id || null;
      if (!tierId) {
        const { data: memberData } = await supabase
          .from("members")
          .select("tier_id")
          .eq("id", memberId)
          .limit(1);
        tierId = memberData?.[0]?.tier_id || null;
      }

      // Record payment
      const currentYear = new Date().getFullYear().toString();
      await supabase.from("payments").insert({
        member_id: memberId,
        tier_id: tierId,
        amount_eur: session.amount_total ? session.amount_total / 100 : 0,
        payment_status: "paid",
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
        season: currentYear,
      });

      // Activate membership + generate card
      await activateMembership(memberId, tierId);

      // Mark renewal token used if present
      const renewalTokenId = session.metadata?.renewal_token_id;
      if (renewalTokenId) {
        await supabase
          .from("renewal_tokens")
          .update({ used: true })
          .eq("id", renewalTokenId);
      }

      break;
    }

    // ===== NEW: PaymentIntent authorization confirmed =====
    case "payment_intent.amount_capturable_updated": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const memberId = pi.metadata?.member_id;

      console.log("[webhook] amount_capturable_updated", { pi_id: pi.id, memberId });

      if (!memberId) break;

      // Idempotency: skip if already authorized
      const { data: existingAuth } = await supabase
        .from("payments")
        .select("id, payment_capture_status")
        .eq("stripe_payment_intent_id", pi.id)
        .limit(1);

      if (existingAuth?.[0]?.payment_capture_status === "authorized") break;

      // Extract capture_before from latest charge
      // Stripe puts capture_before on charge.payment_method_details.card.capture_before
      // as a Unix timestamp. The SDK types may not include it, so we access it dynamically.
      let captureBefore: string | null = null;
      try {
        const fullPI = await getStripe().paymentIntents.retrieve(pi.id, {
          expand: ["latest_charge"],
        });
        const charge = fullPI.latest_charge as Stripe.Charge | null;
        // Access capture_before dynamically — it's present in the API response
        // but may not be in the SDK's TypeScript types for all versions
        const cardDetails = charge?.payment_method_details?.card;
        const captureBeforeTs = cardDetails
          ? (cardDetails as unknown as Record<string, unknown>)["capture_before"]
          : undefined;
        if (typeof captureBeforeTs === "number") {
          captureBefore = new Date(captureBeforeTs * 1000).toISOString();
        }
      } catch (err) {
        // If retrieve fails, return 500 so Stripe retries and we can populate capture_before
        // Without it, committee reminders will not fire for this application
        console.error("[webhook] Failed to retrieve capture_before — returning 500 for retry:", err);
        return NextResponse.json(
          { error: "Failed to retrieve charge details" },
          { status: 500 }
        );
      }

      // Store payment method ID for potential off-session fallback
      const paymentMethodId = typeof pi.payment_method === "string"
        ? pi.payment_method
        : pi.payment_method?.id || null;

      const { error: authUpdateError } = await supabase
        .from("payments")
        .update({
          payment_capture_status: "authorized",
          authorized_at: new Date().toISOString(),
          capture_before: captureBefore,
          stripe_payment_method_id: paymentMethodId,
        })
        .eq("stripe_payment_intent_id", pi.id);

      if (authUpdateError) {
        console.error("[webhook] Payment auth update failed:", authUpdateError);
      }

      // Now notify committee — card is authorized, application is ready for review
      const { data: memberData } = await supabase
        .from("members")
        .select("first_name, last_name, email, company_name, company_role, originator_note")
        .eq("id", memberId)
        .limit(1);

      if (memberData?.[0]) {
        const m = memberData[0];

        // Send application-received email to applicant (after card auth, not on form submit)
        await sendEmail({
          to: m.email,
          templateAlias: "application-received",
          templateModel: {
            first_name: m.first_name,
            last_name: m.last_name,
            preheader: "We've received your application to the Geneva Polo Club Social Club.",
          },
        }).catch((err) =>
          console.error("[webhook] application-received email failed:", err)
        );

        // Notify committee — card is authorized, application is ready for review
        await notifyCommittee(memberId, {
          name: `${m.first_name} ${m.last_name}`,
          email: m.email,
          company: m.company_name || "",
          role: m.company_role || "",
          note: m.originator_note,
        });
      }

      break;
    }

    // ===== NEW: PaymentIntent succeeded (after capture or off-session) =====
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const memberId = pi.metadata?.member_id;

      console.log("[webhook] payment_intent.succeeded", { pi_id: pi.id, memberId });

      if (!memberId) break;

      // Verify member has been approved before activating
      const { data: memberCheck } = await supabase
        .from("members")
        .select("status")
        .eq("id", memberId)
        .limit(1);

      if (!memberCheck?.[0] || !["approved", "active"].includes(memberCheck[0].status)) {
        console.log("[webhook] payment_intent.succeeded skipped — member not approved", {
          pi_id: pi.id,
          memberId,
          memberStatus: memberCheck?.[0]?.status,
        });
        break;
      }

      // Atomic idempotency: conditional update only if not already succeeded
      const { data: updatedPayment } = await supabase
        .from("payments")
        .update({
          payment_capture_status: "succeeded",
          payment_status: "paid",
          paid_at: new Date().toISOString(),
        })
        .eq("stripe_payment_intent_id", pi.id)
        .neq("payment_capture_status", "succeeded")
        .select("id, tier_id")
        .limit(1);

      if (!updatedPayment?.length) {
        console.log("[webhook] payment_intent.succeeded skipped — already processed", { pi_id: pi.id });
        break;
      }

      const tierId = updatedPayment[0].tier_id || null;

      // Activate membership + generate card
      try {
        await activateMembership(memberId, tierId);
      } catch (err) {
        console.error("[webhook] activateMembership failed:", err);
        return NextResponse.json({ error: "Activation failed" }, { status: 500 });
      }

      break;
    }

    // ===== NEW: PaymentIntent canceled (hold expired or manual cancel) =====
    case "payment_intent.canceled": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const memberId = pi.metadata?.member_id;

      console.log("[webhook] payment_intent.canceled", {
        pi_id: pi.id,
        memberId,
        reason: pi.cancellation_reason,
      });

      if (!memberId) break;

      const isAutomatic = pi.cancellation_reason === "automatic";
      const newStatus = isAutomatic ? "hold_expired" : "cancelled";

      await supabase
        .from("payments")
        .update({ payment_capture_status: newStatus })
        .eq("stripe_payment_intent_id", pi.id);

      break;
    }

    // ===== NEW: PaymentIntent payment failed =====
    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const memberId = pi.metadata?.member_id;

      console.log("[webhook] payment_intent.payment_failed", { pi_id: pi.id, memberId });

      if (!memberId) break;

      await supabase
        .from("payments")
        .update({
          payment_capture_status: "failed",
          payment_failed_at: new Date().toISOString(),
        })
        .eq("stripe_payment_intent_id", pi.id);

      break;
    }

    // ===== NEW: PaymentIntent requires action (user dropped off during 3DS) =====
    case "payment_intent.requires_action": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const memberId = pi.metadata?.member_id;

      console.log("[webhook] payment_intent.requires_action", { pi_id: pi.id, memberId });

      if (!memberId) break;

      await supabase
        .from("payments")
        .update({ payment_capture_status: "requires_action" })
        .eq("stripe_payment_intent_id", pi.id);

      break;
    }

    default:
      // Unhandled event type — log and return 200
      console.log("[webhook] unhandled event type:", event.type);
  }

  return NextResponse.json({ received: true });
}
