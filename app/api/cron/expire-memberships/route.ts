import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // Find active members whose end_date has passed
  const { data: expired, error } = await supabase
    .from("members")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("end_date", today)
    .not("end_date", "is", null)
    .select("id, email, first_name, last_name, end_date");

  if (error) {
    console.error("[expire-memberships] Failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const count = expired?.length || 0;

  // Deactivate their cards
  if (count > 0) {
    const memberIds = expired!.map((m) => m.id);
    await supabase
      .from("membership_cards")
      .update({ is_active: false })
      .in("member_id", memberIds)
      .eq("is_active", true);

    console.log(
      `[expire-memberships] Expired ${count} members:`,
      expired!.map((m) => `${m.first_name} ${m.last_name} (${m.email}, end_date: ${m.end_date})`)
    );
  }

  return NextResponse.json({ expired: count });
}
