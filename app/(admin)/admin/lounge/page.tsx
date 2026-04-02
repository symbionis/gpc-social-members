import { createAdminClient } from "@/lib/supabase/admin";
import LoungeManager from "@/components/admin/LoungeManager";

const dayOrder: Record<string, number> = { wednesday: 0, saturday: 1, sunday: 2 };

export default async function LoungePage() {
  const supabase = createAdminClient();

  const { data: sessions } = await supabase
    .from("lounge_sessions")
    .select("*");

  const sorted = (sessions || []).sort(
    (a: any, b: any) =>
      (dayOrder[a.day_of_week] ?? 99) - (dayOrder[b.day_of_week] ?? 99)
  );

  const { data: adminUsers } = await supabase
    .from("admin_users")
    .select("id, first_name, last_name");

  const adminMap: Record<string, string> = {};
  for (const admin of adminUsers || []) {
    adminMap[admin.id] = `${admin.first_name} ${admin.last_name}`;
  }

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Lounge Schedule
      </h1>
      <LoungeManager sessions={sorted} adminMap={adminMap} />
    </div>
  );
}
