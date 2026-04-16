import { createAdminClient } from "@/lib/supabase/admin";
import ApplicationQueue from "@/components/admin/ApplicationQueue";
import type { PaymentCaptureStatus } from "@/types/database";

export default async function ApplicationsPage() {
  const supabase = createAdminClient();

  const { data: applications } = await supabase
    .from("members")
    .select(
      "id, title, first_name, last_name, email, phone, tier_id, status, company_name, company_role, linkedin_url, originator_note, originator_id, created_at, last_reminder_sent_at, approved_at"
    )
    .or("status.in.(pending,approved,declined),approved_at.not.is.null")
    .order("created_at", { ascending: false });

  // Fetch payment data for these members
  const memberIds = (applications || []).map((a) => a.id);
  const { data: payments } = memberIds.length
    ? await supabase
        .from("payments")
        .select("member_id, payment_capture_status, capture_before, authorized_at")
        .in("member_id", memberIds)
        .not("payment_capture_status", "is", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  // Build a map of member_id -> latest payment capture info
  const paymentMap: Record<string, { payment_capture_status: PaymentCaptureStatus; capture_before: string | null; authorized_at: string | null }> = {};
  for (const p of payments || []) {
    if (!paymentMap[p.member_id]) {
      paymentMap[p.member_id] = {
        payment_capture_status: p.payment_capture_status as PaymentCaptureStatus,
        capture_before: p.capture_before,
        authorized_at: p.authorized_at,
      };
    }
  }

  // Fetch tier names
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, price_eur");

  // Fetch originator names
  const { data: originators } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name")
    .eq("is_originator", true);

  const tierMap = Object.fromEntries(
    (tiers || []).map((t: Record<string, unknown>) => [
      t.id,
      { name: t.name, price_eur: t.price_eur },
    ])
  );
  const originatorMap = Object.fromEntries(
    (originators || []).map((o: Record<string, unknown>) => [
      o.id,
      `${o.first_name} ${o.last_name}`,
    ])
  );

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Applications
      </h1>
      <ApplicationQueue
        applications={applications || []}
        tierMap={tierMap}
        originatorMap={originatorMap}
        paymentMap={paymentMap}
      />
    </div>
  );
}
