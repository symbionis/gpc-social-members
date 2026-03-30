import { runRenewalReminders } from "@/lib/cron/renewal-reminders";
import { NextResponse, type NextRequest } from "next/server";

// Can still be called externally with CRON_SECRET, or internally via node-cron
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRenewalReminders();
  return NextResponse.json(result);
}
