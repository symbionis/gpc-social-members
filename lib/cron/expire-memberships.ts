import { createAdminClient } from "@/lib/supabase/admin";

export interface ExpireMembershipsResult {
  expired: number;
}

export async function runExpireMemberships(): Promise<ExpireMembershipsResult> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // Find active members whose end_date has passed
  const { data: expiredMembers, error } = await supabase
    .from("members")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("end_date", today)
    .not("end_date", "is", null)
    .select("id, email, first_name, last_name, end_date");

  if (error) {
    console.error("[expire-memberships] Failed:", error);
    return { expired: 0 };
  }

  const count = expiredMembers?.length || 0;

  // Deactivate their cards
  if (count > 0) {
    const memberIds = expiredMembers!.map((m) => m.id);
    await supabase
      .from("membership_cards")
      .update({ is_active: false })
      .in("member_id", memberIds)
      .eq("is_active", true);

    console.log(
      `[expire-memberships] Expired ${count} members:`,
      expiredMembers!.map((m) => `${m.first_name} ${m.last_name} (${m.email}, end_date: ${m.end_date})`)
    );
  }

  return { expired: count };
}
