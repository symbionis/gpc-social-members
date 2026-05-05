import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseBroadcastPayload } from "@/lib/broadcast/validate";
import { requireAgentToken, unauthorizedResponse } from "@/lib/agent/auth";
import { trackAgentAction } from "@/lib/agent/track";
import type {
  AgentApiError,
  BroadcastDraftCreatedResponse,
} from "@/lib/agent/responses";

const ENDPOINT = "/api/agent/broadcasts/draft";

/**
 * Agent-facing endpoint to create a draft broadcast. Forces status='draft'
 * regardless of input — the admin send pipeline is the only path that may
 * transition to 'sending' / 'sent'.
 *
 * Validation goes through parseBroadcastPayload(body, { forDraft: true }) so
 * the agent surface inherits any future tightening of broadcast validation.
 */
export async function POST(request: NextRequest) {
  const started_at = Date.now();
  const auth = requireAgentToken(request);
  if (!auth.ok) return unauthorizedResponse(auth.status);

  const body = await request.json().catch(() => ({}));
  const parsed = parseBroadcastPayload(body, { forDraft: true });
  if (!parsed.ok) {
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 400, started_at });
    return NextResponse.json<AgentApiError>(
      { error: parsed.error },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .insert({
      subject: parsed.payload.subject,
      body_html: parsed.payload.body_html,
      audience_filter: parsed.payload.audience_filter as unknown as Record<
        string,
        unknown
      >,
      channel: "email",
      status: "draft",
      // created_by is null — the agent has no admin_users row.
      created_by: null,
    })
    .select("id")
    .limit(1)
    .single();

  if (error || !data) {
    if (error) console.error("[agent/broadcasts/draft] insert failed", error);
    trackAgentAction({ endpoint: ENDPOINT, method: "POST", status_code: 500, started_at });
    return NextResponse.json<AgentApiError>(
      { error: "Failed to save draft" },
      { status: 500 }
    );
  }

  trackAgentAction({
    endpoint: ENDPOINT,
    method: "POST",
    status_code: 201,
    started_at,
    extra: { broadcast_id: data.id },
  });
  return NextResponse.json<BroadcastDraftCreatedResponse>(
    {
      broadcast_id: data.id,
      edit_url: "/admin/messages?tab=drafts",
    },
    { status: 201 }
  );
}
