import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/postmark";
import { generateCardNumber } from "@/lib/utils/card";
import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import Stripe from "stripe";

async function recordApprovalAudit(
  adminClient: ReturnType<typeof createAdminClient>,
  memberId: string,
  adminId: string
) {
  // Best-effort: the member is already approved by the time this runs, so an
  // audit/referral insert failure must not throw and turn an otherwise handled
  // response into an unhandled 500.
  try {
    await adminClient.from("applications").insert({
      member_id: memberId,
      reviewed_by: adminId,
      status: "approved",
    });

    const { data: members } = await adminClient
      .from("members")
      .select("originator_id")
      .eq("id", memberId)
      .limit(1);

    if (members?.[0]?.originator_id) {
      await adminClient.from("referrals").insert({
        originator_id: members[0].originator_id,
        member_id: memberId,
      });
    }
  } catch (err) {
    console.error("[approve] recordApprovalAudit failed (non-fatal):", err);
  }
}

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Check if this is a free-tier (honorary) member — auto-activate without Stripe
  const { data: memberForTier } = await adminClient
    .from("members")
    .select("tier_id")
    .eq("id", member_id)
    .eq("status", "pending")
    .limit(1);

  if (memberForTier?.[0]?.tier_id) {
    const { data: tierCheck } = await adminClient
      .from("membership_tiers")
      .select("price_eur")
      .eq("id", memberForTier[0].tier_id)
      .limit(1);

    if (tierCheck?.[0] && tierCheck[0].price_eur === 0) {
      // --- FREE TIER: auto-activate directly (single atomic UPDATE) ---
      const now = new Date();
      const startDate = now.toISOString().slice(0, 10);
      const endDate = new Date(now);
      endDate.setFullYear(endDate.getFullYear() + 1);
      const endDateStr = endDate.toISOString().slice(0, 10);

      const { data: updated, error: updateError } = await adminClient
        .from("members")
        .update({
          status: "active",
          approved_by: admin.id,
          approved_at: now.toISOString(),
          start_date: startDate,
          end_date: endDateStr,
        })
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

      // Create free payment record
      await adminClient.from("payments").insert({
        member_id,
        tier_id: memberForTier[0].tier_id,
        amount_eur: 0,
        payment_status: "free",
        season: now.getFullYear().toString(),
      });

      // Generate card
      const cardNumber = generateCardNumber();
      const verifyUrl = `${appUrl}/verify/${cardNumber}`;

      const { data: newCards } = await adminClient
        .from("membership_cards")
        .insert({
          member_id,
          card_number: cardNumber,
          qr_code_data: verifyUrl,
          tier_id: memberForTier[0].tier_id,
          valid_from: startDate,
          valid_until: endDateStr,
          is_active: true,
        })
        .select("id")
        .limit(1);

      // Deactivate old cards
      if (newCards?.[0]?.id) {
        await adminClient
          .from("membership_cards")
          .update({ is_active: false })
          .eq("member_id", member_id)
          .neq("id", newCards[0].id)
          .eq("is_active", true);
      }

      // Get member + tier info for email
      const { data: memberInfo } = await adminClient
        .from("members")
        .select("email, first_name, last_name")
        .eq("id", member_id)
        .limit(1);

      const { data: tierInfo } = await adminClient
        .from("membership_tiers")
        .select("name")
        .eq("id", memberForTier[0].tier_id)
        .limit(1);

      if (memberInfo?.[0]) {
        await sendEmail({
          to: memberInfo[0].email,
          templateAlias: "member-approved",
          templateModel: {
            first_name: memberInfo[0].first_name,
            last_name: memberInfo[0].last_name,
            tier_name: tierInfo?.[0]?.name || "Member",
            has_card: true,
            card_number: cardNumber,
            portal_url: `${appUrl}/login`,
            checkout_url: null,
            has_payment: null,
            dashboard_url: null,
            preheader: "Your membership is now active. Welcome to the Geneva Polo Club!",
          },
        }).catch((err) =>
          console.error("[approve] member-approved email failed:", err)
        );
      }

      await recordApprovalAudit(adminClient, member_id, admin.id);
      return NextResponse.json({ success: true });
    }
  }

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

  if (payment && payment.stripe_payment_intent_id) {
    // --- NEW FLOW: PaymentIntent manual capture ---

    if (payment.payment_capture_status === "authorized") {
      // Within hold window — lock first, then capture

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

      // Now capture — if this fails, revert the member status
      try {
        await stripe.paymentIntents.capture(
          payment.stripe_payment_intent_id,
          {},
          { idempotencyKey: `pi_capture_${payment.stripe_payment_intent_id}` }
        );
      } catch (err) {
        console.error("[approve] Stripe capture failed, reverting member status:", err);
        await adminClient
          .from("members")
          .update({ status: "pending", approved_by: null, approved_at: null })
          .eq("id", member_id);
        return NextResponse.json(
          { error: "Failed to capture payment. The hold may have expired." },
          { status: 500 }
        );
      }

      // Membership activation + card generation happens in the webhook handler
      // (payment_intent.succeeded fires after capture)
      await recordApprovalAudit(adminClient, member_id, admin.id);

    } else if (payment.payment_capture_status === "hold_expired") {
      // Past hold window — attempt off-session charge on saved PaymentMethod

      // Validate required fields before proceeding
      const { data: memberRow } = await adminClient
        .from("members")
        .select("stripe_customer_id, tier_id")
        .eq("id", member_id)
        .limit(1);

      const memberInfo = memberRow?.[0];
      if (!memberInfo?.stripe_customer_id || !payment.stripe_payment_method_id) {
        return NextResponse.json(
          { error: "Missing payment credentials for off-session charge." },
          { status: 500 }
        );
      }

      // Get tier amount — guard against missing tier
      const { data: tiers } = await adminClient
        .from("membership_tiers")
        .select("price_eur, slug")
        .eq("id", memberInfo.tier_id)
        .limit(1);

      const tier = tiers?.[0];
      if (!tier || tier.price_eur <= 0) {
        return NextResponse.json(
          { error: "Tier not found or has no price configured." },
          { status: 500 }
        );
      }

      // Optimistic lock
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

      const amountInCentimes = Math.round(tier.price_eur * 100);

      // Update payments row with new PI id BEFORE confirming, so webhook can find it
      // Use stable idempotency key based on payment row ID
      try {
        // Create PI without confirming first
        const newPI = await stripe.paymentIntents.create(
          {
            amount: amountInCentimes,
            currency: "chf",
            customer: memberInfo.stripe_customer_id,
            payment_method: payment.stripe_payment_method_id,
            off_session: true,
            metadata: { member_id, tier_slug: tier.slug, payment_id: payment.id },
          },
          { idempotencyKey: `pi_offsession_${payment.id}` }
        );

        // Update payments row BEFORE confirming so webhook can find this row
        await adminClient
          .from("payments")
          .update({
            stripe_payment_intent_id: newPI.id,
            payment_capture_status: "charging_offsession",
          })
          .eq("id", payment.id);

        // Now confirm — webhook may fire after this
        await stripe.paymentIntents.confirm(newPI.id);

        // Do NOT write 'succeeded' here — let the webhook own that transition
        await recordApprovalAudit(adminClient, member_id, admin.id);

      } catch (err: unknown) {
        if (err instanceof Stripe.errors.StripeCardError && err.code === "authentication_required") {
          // SCA required — save the new PI and email applicant
          const newPIId = (err.raw as { payment_intent?: { id: string } })?.payment_intent?.id;

          if (newPIId) {
            await adminClient
              .from("payments")
              .update({
                stripe_payment_intent_id: newPIId,
                payment_capture_status: "requires_action",
              })
              .eq("id", payment.id);
          }

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
              templateAlias: "payment-sca-required",
              templateModel: {
                first_name: memberData[0].first_name,
                sca_url: `${appUrl}/pay/retry/${token}`,
                preheader: "Your application has been approved. Please complete payment authentication.",
              },
            });
          }

          await recordApprovalAudit(adminClient, member_id, admin.id);

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

          await recordApprovalAudit(adminClient, member_id, admin.id);

          return NextResponse.json({
            success: true,
            payment_status: "failed",
            message: "Approved but payment failed. Applicant has been emailed with a retry link.",
          });
        }
      }
    }
  } else {
    // --- FALLBACK FLOW: no authorized/hold_expired PI to capture ---
    // Reached either when the member predates the manual-capture feature, or
    // when their card auth never succeeded (failed / requires_action / cancelled).
    // We send a Stripe Checkout link so the applicant can pay directly.

    // Look up any stale payments row for this member so we can clean it up.
    const { data: stalePayments } = await adminClient
      .from("payments")
      .select("id, stripe_payment_intent_id, payment_capture_status")
      .eq("member_id", member_id)
      .order("created_at", { ascending: false })
      .limit(1);

    const stale = stalePayments?.[0];

    // Verify the tier has a positive price BEFORE marking the member approved.
    // Without it we cannot build a usable payment link.
    const { data: memberRow } = await adminClient
      .from("members")
      .select("tier_id")
      .eq("id", member_id)
      .limit(1)
      .single();

    const { data: tiers } = await adminClient
      .from("membership_tiers")
      .select("name, price_eur")
      .eq("id", memberRow?.tier_id ?? "")
      .limit(1);

    const tier = tiers?.[0];

    if (!tier || tier.price_eur <= 0) {
      return NextResponse.json(
        {
          error:
            "Cannot approve: tier has no price configured. Set a price on the tier before approving.",
        },
        { status: 500 }
      );
    }

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

    // Cancel the orphaned PaymentIntent in Stripe (best effort) and mark the
    // stale row so it stops surfacing as "Payment Failed" in the admin queue.
    if (stale && stale.stripe_payment_intent_id &&
        ["failed", "requires_action", "pending"].includes(stale.payment_capture_status ?? "")) {
      try {
        await stripe.paymentIntents.cancel(stale.stripe_payment_intent_id);
      } catch (err) {
        // Already canceled, succeeded, or otherwise non-cancellable — fine.
        console.warn(
          "[approve] Could not cancel orphaned PaymentIntent (likely already in a terminal state):",
          err
        );
      }
      await adminClient
        .from("payments")
        .update({ payment_capture_status: "cancelled" })
        .eq("id", stale.id);
    }

    // Create Checkout Session for the applicant to pay directly.
    let checkoutUrl = "";
    let checkoutError: string | null = null;
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: member.email,
        line_items: [
          {
            price_data: {
              currency: "chf",
              unit_amount: Math.round(tier.price_eur * 100),
              product_data: { name: tier.name },
            },
            quantity: 1,
          },
        ],
        metadata: { member_id: member.id },
        success_url: `${appUrl}/login?payment=success`,
        cancel_url: `${appUrl}/login?payment=cancelled`,
      });
      checkoutUrl = session.url || "";
      if (!checkoutUrl) {
        checkoutError = "Stripe returned no checkout URL.";
      }
    } catch (err) {
      console.error("[approve] Checkout Session creation failed:", err);
      checkoutError = err instanceof Error ? err.message : "Unknown Stripe error.";
    }

    // The committee decision stands and the member is already marked approved,
    // so record the approval audit regardless of the payment-link outcome.
    await recordApprovalAudit(adminClient, member_id, admin.id);

    if (checkoutError) {
      // Do NOT send a paymentless "you're approved" email — that strands the
      // member as approved with no way to pay and hides the failure. Surface
      // the real Stripe error so the admin can resolve it and then use
      // "Resend Payment Link" on the member's page.
      return NextResponse.json(
        {
          error: `Member approved, but the payment link could not be created (Stripe: ${checkoutError}). Resolve the issue, then use "Resend Payment Link" on the member's page.`,
        },
        { status: 502 }
      );
    }

    await sendEmail({
      to: member.email,
      templateAlias: "member-approved",
      templateModel: {
        first_name: member.first_name,
        last_name: member.last_name,
        tier_name: tier.name,
        checkout_url: checkoutUrl,
        has_payment: !!checkoutUrl,
        dashboard_url: `${appUrl}/login`,
      },
    });
  }

  return NextResponse.json({ success: true });
}
