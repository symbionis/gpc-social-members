import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCardNumber } from "@/lib/utils/card";
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const memberId = session.metadata?.member_id;

    if (!memberId) {
      console.error("No member_id in session metadata");
      return NextResponse.json({ error: "No member_id" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Idempotency: check if payment already recorded
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("id")
      .eq("stripe_checkout_session_id", session.id)
      .limit(1);

    if (existingPayments && existingPayments.length > 0) {
      return NextResponse.json({ received: true, already_processed: true });
    }

    // Get member's tier_id for the payment and card records
    const { data: memberData } = await supabase
      .from("members")
      .select("tier_id")
      .eq("id", memberId)
      .limit(1);

    const memberTierId = memberData?.[0]?.tier_id || null;

    // Record payment
    const currentYear = new Date().getFullYear().toString();
    await supabase.from("payments").insert({
      member_id: memberId,
      tier_id: memberTierId,
      amount_eur: session.amount_total ? session.amount_total / 100 : 0,
      payment_status: "paid",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : null,
      season: currentYear,
    });

    // Activate member
    await supabase
      .from("members")
      .update({ status: "active" })
      .eq("id", memberId);

    // Generate digital card
    const cardNumber = generateCardNumber();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const validUntilDate = new Date(now);
    validUntilDate.setFullYear(validUntilDate.getFullYear() + 1);
    const validUntil = validUntilDate.toISOString().slice(0, 10);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const verifyUrl = `${appUrl}/verify/${cardNumber}`;

    await supabase.from("membership_cards").insert({
      member_id: memberId,
      card_number: cardNumber,
      qr_code_data: verifyUrl,
      tier_id: memberTierId,
      valid_from: today,
      valid_until: validUntil,
      is_active: true,
    });

    // Trigger payment confirmation email
    fetch(`${appUrl}/api/email/payment-confirmed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      },
      body: JSON.stringify({ member_id: memberId, card_number: cardNumber }),
    }).catch((err) =>
      console.error("Failed to trigger payment confirmation email:", err)
    );
  }

  return NextResponse.json({ received: true });
}
