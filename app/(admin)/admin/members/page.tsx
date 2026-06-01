import { createAdminClient } from "@/lib/supabase/admin";
import MemberList from "@/components/admin/MemberList";
import {
  buildPaidMonthsByMember,
  type PaidPaymentRow,
} from "@/lib/members/payments";

const PAYMENTS_PAGE_SIZE = 1000;

export default async function MembersPage() {
  const supabase = createAdminClient();

  const { data: members } = await supabase
    .from("members")
    .select(
      "id, first_name, last_name, email, member_number, tier_id, status, originator_id, start_date, end_date, created_at"
    )
    .order("created_at", { ascending: false });

  // Every captured payment, read in 1000-row pages to clear the Supabase
  // default response cap (payments accumulate across seasons). No paid_at-null
  // guard: the checkout.session.completed path writes 'paid' without paid_at,
  // and buildPaidMonthsByMember falls back to created_at for those rows.
  const paidRows: PaidPaymentRow[] = [];
  for (let from = 0; ; from += PAYMENTS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("payments")
      .select("member_id, paid_at, created_at")
      .eq("payment_status", "paid")
      .range(from, from + PAYMENTS_PAGE_SIZE - 1);
    if (error) break;
    const rows = (data ?? []) as PaidPaymentRow[];
    paidRows.push(...rows);
    if (rows.length < PAYMENTS_PAGE_SIZE) break;
  }
  const paidMonthsByMember = buildPaidMonthsByMember(paidRows);

  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name");

  const { data: originators } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name")
    .eq("is_originator", true);

  const tierMap = Object.fromEntries(
    (tiers || []).map((t: Record<string, unknown>) => [t.id, t.name])
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
        Members
      </h1>
      <MemberList
        members={members || []}
        tierMap={tierMap}
        originatorMap={originatorMap}
        paidMonthsByMember={paidMonthsByMember}
      />
    </div>
  );
}
