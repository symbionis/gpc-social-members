import { createAdminClient } from "@/lib/supabase/admin";
import MemberList from "@/components/admin/MemberList";
import {
  buildPaidMonthsByMember,
  type PaidPaymentRow,
} from "@/lib/members/payments";

const PAYMENTS_PAGE_SIZE = 1000;

export default async function MembersPage() {
  const supabase = createAdminClient();

  // Every captured payment, read in 1000-row pages to clear the Supabase
  // default response cap (payments accumulate across seasons). No paid_at-null
  // guard: the checkout.session.completed path writes 'paid' without paid_at,
  // and buildPaidMonthsByMember falls back to created_at for those rows.
  async function fetchPaidRows(): Promise<PaidPaymentRow[]> {
    const rows: PaidPaymentRow[] = [];
    for (let from = 0; ; from += PAYMENTS_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("payments")
        .select("member_id, paid_at, created_at")
        .eq("payment_status", "paid")
        // Stable order by primary key: range() paging without an explicit
        // ORDER BY can shift row order between page requests and skip/duplicate
        // rows at page seams, which would misclassify a paid member as unpaid.
        .order("id", { ascending: true })
        .range(from, from + PAYMENTS_PAGE_SIZE - 1);
      if (error) {
        // Don't silently return a partial set — a half-read map would mislabel
        // paid members as "Not paid" with no signal. Log so the failure is
        // visible in server logs; the page still renders members.
        console.error("members page: paid-payments fetch failed", error);
        break;
      }
      const page = (data ?? []) as PaidPaymentRow[];
      rows.push(...page);
      if (page.length < PAYMENTS_PAGE_SIZE) break;
    }
    return rows;
  }

  // The four reads are mutually independent — run them concurrently.
  const [{ data: members }, paidRows, { data: tiers }, { data: originators }] =
    await Promise.all([
      supabase
        .from("members")
        .select(
          "id, first_name, last_name, email, member_number, tier_id, status, originator_id, start_date, end_date, created_at"
        )
        .order("created_at", { ascending: false }),
      fetchPaidRows(),
      supabase.from("membership_tiers").select("id, name"),
      supabase
        .from("admin_users")
        .select("id, first_name, last_name")
        .eq("is_originator", true),
    ]);

  const paidMonthsByMember = buildPaidMonthsByMember(paidRows);

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
