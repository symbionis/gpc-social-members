import { createAdminClient } from "@/lib/supabase/admin";
import type { AudienceFilter, BroadcastRecipient } from "@/lib/broadcast/types";

/**
 * Translate an AudienceFilter into a recipient list for the channel adapter.
 *
 * Always filters out `marketing_consent = false` so the resolver is the single
 * choke point for consent. The orchestrator never sees unconsented members,
 * meaning no downstream code can accidentally email them.
 */
export async function resolveAudience(
  filter: AudienceFilter
): Promise<BroadcastRecipient[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("members")
    .select("id, email, first_name, last_name")
    .eq("marketing_consent", true);

  if (filter.status !== "all") {
    query = query.eq("status", filter.status);
  }

  if (filter.tier_id) {
    query = query.eq("tier_id", filter.tier_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to resolve audience: ${error.message}`);
  }

  return (data ?? []).map((m) => ({
    member_id: m.id,
    email: m.email,
    first_name: m.first_name,
    last_name: m.last_name,
  }));
}
