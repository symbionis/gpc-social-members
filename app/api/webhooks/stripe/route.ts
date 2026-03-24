import { stripe } from "@/lib/stripe";
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
    event = stripe.webhooks.constructEvent(
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
      .eq("stripe_session_id", session.id)
      .limit(1);

    if (existingPayments && existingPayments.length > 0) {
      return NextResponse.json({ received: true, already_processed: true });
    }

    // Get current season
    const { data: seasons } = await supabase
      .from("seasons")
      .select("id, end_date")
      .gte("end_date", new Date().toISOString().slice(0, 10))
      .order("start_date", { ascending: true })
      .limit(1);

    const season = seasons?.[0];

    // Record payment
    await supabase.from("payments").insert({
      member_id: memberId,
      season_id: season?.id || null,
      amount_cents: session.amount_total || 0,
      status: "paid",
      stripe_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : null,
    });

    // Activate member
    await supabase
      .from("members")
      .update({ status: "active", payment_status: "paid" })
      .eq("id", memberId);

    // Generate digital card
    const cardNumber = generateCardNumber();
    const today = new Date().toISOString().slice(0, 10);
    const validUntil = season?.end_date || `${new Date().getFullYear()}-12-31`;

    await supabase.from("membership_cards").insert({
      member_id: memberId,
      card_number: cardNumber,
      valid_from: today,
      valid_until: validUntil,
      is_active: true,
    });

    // TODO: Trigger payment confirmation email via Postmark
    console.log(
      `Payment confirmed for member ${memberId}, card ${cardNumber}`
    );
  }

  return NextResponse.json({ received: true });
}
