import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/postmark";
import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();

  // Verify admin is on approval committee
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role, is_approval_committee")
    .eq("email", user.email)
    .limit(1);

  const admin = admins?.[0];
  if (
    !admin ||
    (admin.role !== "super_admin" && !admin.is_approval_committee)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { member_id } = await request.json();

  // Look up the payment record for this member (new capture flow)
  const { data: payments } = await adminClient
    .from("payments")
    .select("id, stripe_payment_intent_id, stripe_payment_method_id, payment_capture_status")
    .eq("member_id", member_id)
    .in("payment_capture_status", ["authorized", "hold_expired"])
    .order("created_at", { ascending: false })
    .limit(1);

  const payment = payments?.[0];
  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (payment && payment.stripe_payment_intent_id) {
    // --- NEW FLOW: PaymentIntent manual capture ---

    if (payment.payment_capture_status === "authorized") {
      // Within hold window — capture the existing PaymentIntent
      try {
        await stripe.paymentIntents.capture(
          payment.stripe_payment_intent_id,
          {},
          { idempotencyKey: `pi_capture_${payment.stripe_payment_intent_id}` }
        );
      } catch (err) {
        console.error("[approve] Stripe capture failed:", err);
        return NextResponse.json(
          { error: "Failed to capture payment. The hold may have expired." },
          { status: 500 }
        );
      }

      // Optimistic lock: update from pending → approved
      const { data: updated, error: updateError } = await adminClient
        .from("members")
        .update({ status: "approved", approved_by: admin.id, approved_at: new Date().toISOString() })
        .eq("id", member_id)
        .eq("status", "pending")
        .select("id")
        .limit(1);

      if (updateError || !updated?.length) {
        return NextResponse.json(
          { error: "This application has already been actioned by another committee member." },
          { status: 409 }
        );
      }

      // Membership activation + card generation happens in the webhook handler
      // (payment_intent.succeeded fires after capture)

    } else if (payment.payment_capture_status === "hold_expired") {
      // Past hold window — attempt off-session charge on saved PaymentMethod

      // Optimistic lock first
      const { data: updated, error: updateError } = await adminClient
        .from("members")
        .update({ status: "approved", approved_by: admin.id, approved_at: new Date().toISOString() })
        .eq("id", member_id)
        .eq("status", "pending")
        .select("id, stripe_customer_id, tier_id")
        .limit(1);

      if (updateError || !updated?.length) {
        return NextResponse.json(
          { error: "This application has already been actioned by another committee member." },
          { status: 409 }
        );
      }

      const member = updated[0];

      // Set intermediate state
      await adminClient
        .from("payments")
        .update({ payment_capture_status: "charging_offsession" })
        .eq("id", payment.id);

      // Get tier amount
      const { data: tiers } = await adminClient
        .from("membership_tiers")
        .select("price_eur, slug")
        .eq("id", member.tier_id)
        .limit(1);

      const tier = tiers?.[0];
      const amountInCentimes = Math.round((tier?.price_eur || 0) * 100);

      try {
        const newPI = await stripe.paymentIntents.create(
          {
            amount: amountInCentimes,
            currency: "chf",
            customer: member.stripe_customer_id!,
            payment_method: payment.stripe_payment_method_id!,
            off_session: true,
            confirm: true,
            metadata: { member_id, tier_slug: tier?.slug || "" },
          },
          { idempotencyKey: `pi_offsession_${member_id}_${Date.now()}` }
        );

        // Update payment record with new PI
        await adminClient
          .from("payments")
          .update({
            stripe_payment_intent_id: newPI.id,
            payment_capture_status: "succeeded",
          })
          .eq("id", payment.id);

        // Membership activation happens via payment_intent.succeeded webhook

      } catch (err: unknown) {
        const stripeErr = err as { code?: string; raw?: { payment_intent?: { id: string } } };

        if (stripeErr.code === "authentication_required") {
          // SCA required — save the new PI and email applicant
          const newPIId = stripeErr.raw?.payment_intent?.id;
          await adminClient
            .from("payments")
            .update({
              stripe_payment_intent_id: newPIId || null,
              payment_capture_status: "requires_action",
            })
            .eq("id", payment.id);

          // Get member email for notification
          const { data: memberData } = await adminClient
            .from("members")
            .select("email, first_name")
            .eq("id", member_id)
            .limit(1);

          if (memberData?.[0]) {
            // Create retry token for SCA completion
            const token = randomUUID();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 14);

            await adminClient.from("payment_retry_tokens").insert({
              member_id,
              payment_id: payment.id,
              token,
              expires_at: expiresAt.toISOString(),
            });

            await sendEmail({
              to: memberData[0].email,
              templateAlias: "payment-sca-required",
              templateModel: {
                first_name: memberData[0].first_name,
                sca_url: `${appUrl}/pay/retry/${token}`,
                preheader: "Your application has been approved. Please complete payment authentication.",
              },
            });
          }

          return NextResponse.json({
            success: true,
            payment_status: "requires_action",
            message: "Approved but payment requires authentication. Applicant has been emailed.",
          });

        } else {
          // Card declined — set failed, email applicant with retry link
          await adminClient
            .from("payments")
            .update({
              payment_capture_status: "failed",
              payment_failed_at: new Date().toISOString(),
              payment_retry_deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .eq("id", payment.id);

          const { data: memberData } = await adminClient
            .from("members")
            .select("email, first_name")
            .eq("id", member_id)
            .limit(1);

          if (memberData?.[0]) {
            const token = randomUUID();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 14);

            await adminClient.from("payment_retry_tokens").insert({
              member_id,
              payment_id: payment.id,
              token,
              expires_at: expiresAt.toISOString(),
            });

            await sendEmail({
              to: memberData[0].email,
              templateAlias: "payment-retry-required",
              templateModel: {
                first_name: memberData[0].first_name,
                retry_url: `${appUrl}/pay/retry/${token}`,
                preheader: "Your application has been approved but payment failed. Please update your payment method.",
              },
            });
          }

          return NextResponse.json({
            success: true,
            payment_status: "failed",
            message: "Approved but payment failed. Applicant has been emailed with a retry link.",
          });
        }
      }
    }
  } else {
    // --- LEGACY FLOW: No payment record (in-flight member approved before this feature) ---
    const { data: updated, error: updateError } = await adminClient
      .from("members")
      .update({ status: "approved", approved_by: admin.id, approved_at: new Date().toISOString() })
      .eq("id", member_id)
      .eq("status", "pending")
      .select("id, email, first_name, last_name, tier_id")
      .limit(1);

    if (updateError || !updated?.length) {
      return NextResponse.json(
        { error: "This application has already been actioned by another committee member." },
        { status: 409 }
      );
    }

    const member = updated[0];

    // Send welcome email with Checkout Session link (legacy flow)
    const { data: tiers } = await adminClient
      .from("membership_tiers")
      .select("name, stripe_price_id, price_eur")
      .eq("id", member.tier_id)
      .limit(1);

    const tier = tiers?.[0];
    let checkoutUrl = "";

    if (tier?.stripe_price_id && tier.price_eur > 0) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: member.email,
        line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
        metadata: { member_id: member.id },
        success_url: `${appUrl}/login?payment=success`,
        cancel_url: `${appUrl}/login?payment=cancelled`,
      });
      checkoutUrl = session.url || "";
    }

    await sendEmail({
      to: member.email,
      templateAlias: "member-approved",
      templateModel: {
        first_name: member.first_name,
        last_name: member.last_name,
        tier_name: tier?.name || "Member",
        checkout_url: checkoutUrl,
        has_payment: !!checkoutUrl,
        dashboard_url: `${appUrl}/login`,
      },
    });
  }

  // Create application audit entry
  await adminClient.from("applications").insert({
    member_id,
    reviewed_by: admin.id,
    status: "approved",
  });

  // Create referral record if originator exists
  const { data: members } = await adminClient
    .from("members")
    .select("originator_id")
    .eq("id", member_id)
    .limit(1);

  const memberForReferral = members?.[0];
  if (memberForReferral?.originator_id) {
    await adminClient.from("referrals").insert({
      originator_id: memberForReferral.originator_id,
      member_id,
    });
  }

  return NextResponse.json({ success: true });
}
