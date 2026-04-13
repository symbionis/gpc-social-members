import { runCommitteeReminders, runHoldExpirySafetyNet } from "@/lib/cron/committee-reminders";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [reminderResult, safetyResult] = await Promise.all([
      runCommitteeReminders(),
      runHoldExpirySafetyNet(),
    ]);

    return NextResponse.json({
      reminders: reminderResult,
      hold_expiry_safety: safetyResult,
    });
  } catch (error) {
    console.error("[cron/committee-reminders] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
