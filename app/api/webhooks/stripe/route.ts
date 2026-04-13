import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/postmark";
import { generateCardNumber } from "@/lib/utils/card";
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

async function activateMembership(memberId: string, tierId: string | null) {
  const supabase = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Activate member
  await supabase
    .from("members")
    .update({ status: "active", tier_id: tierId })
    .eq("id", memberId);

  // Generate digital card
  const cardNumber = generateCardNumber();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const validUntilDate = new Date(now);
  validUntilDate.setFullYear(validUntilDate.getFullYear() + 1);
  const validUntil = validUntilDate.toISOString().slice(0, 10);
  const verifyUrl = `${appUrl}/verify/${cardNumber}`;

  const { data: newCards } = await supabase
    .from("membership_cards")
    .insert({
      member_id: memberId,
      card_number: cardNumber,
      qr_code_data: verifyUrl,
      tier_id: tierId,
      valid_from: today,
      valid_until: validUntil,
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

  // Get member info for email
  const { data: members } = await supabase
    .from("members")
    .select("email, first_name")
    .eq("id", memberId)
    .limit(1);

  if (members?.[0]) {
    await sendEmail({
      to: members[0].email,
      templateAlias: "payment-confirmed",
      templateModel: {
        first_name: members[0].first_name,
        card_number: cardNumber,
        portal_url: `${appUrl}/login`,
        preheader: "Your membership is now active. Welcome to the Geneva Polo Club!",
      },
    }).catch((err) =>
      console.error("[webhook] payment-confirmed email failed:", err)
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

      await supabase
        .from("payments")
        .update({
          payment_capture_status: "authorized",
          authorized_at: new Date().toISOString(),
          capture_before: captureBefore,
          stripe_payment_method_id: paymentMethodId,
        })
        .eq("stripe_payment_intent_id", pi.id);

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
            preheader: "We've received your application to the Geneva Polo Club Social Member Club.",
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
