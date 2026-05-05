import { sendBroadcast } from "@/lib/broadcast/send";
import { parseBroadcastPayload } from "@/lib/broadcast/validate";
import { requireSuperAdmin } from "@/lib/broadcast/auth";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: auth.status }
    );
  }

  const body = await request.json().catch(() => ({}));
  const broadcastId =
    typeof body?.broadcast_id === "string" && body.broadcast_id.length > 0
      ? body.broadcast_id
      : undefined;

  const parsed = parseBroadcastPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await sendBroadcast({
      ...parsed.payload,
      channel: "email",
      created_by: auth.admin.id,
      broadcast_id: broadcastId,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[broadcasts/send] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
