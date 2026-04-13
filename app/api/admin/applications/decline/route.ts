import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/postmark";
import { NextResponse, type NextRequest } from "next/server";

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

  const { member_id, notes } = await request.json();

  // Optimistic lock: update from pending → declined
  const { data: updated, error: updateError } = await adminClient
    .from("members")
    .update({ status: "declined", declined_reason: notes || null })
    .eq("id", member_id)
    .eq("status", "pending")
    .select("id, email, first_name")
    .limit(1);

  if (updateError || !updated?.length) {
    return NextResponse.json(
      { error: "This application has already been actioned by another committee member." },
      { status: 409 }
    );
  }

  const member = updated[0];

  // Cancel any Stripe PaymentIntent if one exists
  const { data: payments } = await adminClient
    .from("payments")
    .select("id, stripe_payment_intent_id, payment_capture_status")
    .eq("member_id", member_id)
    .in("payment_capture_status", ["authorized", "hold_expired"])
    .limit(1);

  const payment = payments?.[0];
  if (payment?.stripe_payment_intent_id) {
    try {
      await getStripe().paymentIntents.cancel(payment.stripe_payment_intent_id);
    } catch (err) {
      // PI may already be cancelled/expired — log but don't fail
      console.error("[decline] Failed to cancel PI:", err);
    }

    await adminClient
      .from("payments")
      .update({ payment_capture_status: "cancelled" })
      .eq("id", payment.id);
  }

  // Send decline email
  await sendEmail({
    to: member.email,
    templateAlias: "application-declined",
    templateModel: {
      first_name: member.first_name,
      preheader: "We regret to inform you that your application has not been approved.",
    },
  });

  // Create application audit entry
  await adminClient.from("applications").insert({
    member_id,
    reviewed_by: admin.id,
    status: "declined",
    review_notes: notes || null,
  });

  return NextResponse.json({ success: true });
}
