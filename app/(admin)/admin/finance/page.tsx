import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getFinanceSummary } from "@/lib/admin/finance";
import { nowInZurich } from "@/lib/format";
import FinanceDashboard from "@/components/admin/finance/FinanceDashboard";

// Financial data is sensitive: only super_admin and the finance role may view
// this page. The (admin) layout does not restrict team_admin, so the gate lives
// here too (defense in depth — the layout allowlist governs finance navigation,
// this governs who can read the numbers).
const ALLOWED_ROLES = ["super_admin", "finance"];

// Validate a YYYY-MM-DD query param; fall back to the default when malformed so
// a hand-edited URL can't throw out of the server render.
function normalizeDate(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const serverClient = await createClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("id, role")
    .eq("email", user?.email || "")
    .limit(1);

  if (!admins?.[0] || !ALLOWED_ROLES.includes(admins[0].role)) {
    redirect("/admin/dashboard");
  }

  // Default range: 1 January of the current Geneva year → today (Geneva).
  const today = nowInZurich().date; // "YYYY-MM-DD"
  const defaultFrom = `${today.slice(0, 4)}-01-01`;
  const params = await searchParams;
  const from = normalizeDate(params.from, defaultFrom);
  const to = normalizeDate(params.to, today);

  const summary = await getFinanceSummary(adminClient, from, to);

  return <FinanceDashboard summary={summary} />;
}
