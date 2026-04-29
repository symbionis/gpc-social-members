import { createAdminClient } from "@/lib/supabase/admin";
import type { AudienceFilter, BroadcastRecipient } from "@/lib/broadcast/types";

const PAGE_SIZE = 1000; // Supabase default cap; we paginate to bypass it.

export interface ResolvedAudience {
  recipients: BroadcastRecipient[];
  /** Members in scope by status/tier but excluded by marketing_consent=false. */
  skipped: number;
}

/**
 * Translate an AudienceFilter into a recipient list for the channel adapter,
 * plus the count of members excluded by consent.
 *
 * Always filters out `marketing_consent = false` so the resolver is the single
 * choke point for consent. The orchestrator never sees unconsented members,
 * meaning no downstream code can accidentally email them.
 *
 * Paginated to bypass Supabase's 1000-row default response cap, otherwise
 * a large audience would silently truncate.
 */
export async function resolveAudience(
  filter: AudienceFilter
): Promise<ResolvedAudience> {
  const supabase = createAdminClient();

  // Count total members in scope (status + tier) BEFORE consent filter so we
  // can report skipped consent-rejections to the admin.
  let totalQuery = supabase
    .from("members")
    .select("id", { count: "exact", head: true });
  if (filter.status !== "all") {
    totalQuery = totalQuery.eq("status", filter.status);
  }
  if (filter.tier_id) {
    totalQuery = totalQuery.eq("tier_id", filter.tier_id);
  }
  const { count: totalInScope, error: countErr } = await totalQuery;
  if (countErr) {
    throw new Error(`Failed to count audience: ${countErr.message}`);
  }

  // Page through consenting members.
  const recipients: BroadcastRecipient[] = [];
  let from = 0;
  while (true) {
    let pageQuery = supabase
      .from("members")
      .select("id, email, first_name, last_name")
      .eq("marketing_consent", true)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (filter.status !== "all") {
      pageQuery = pageQuery.eq("status", filter.status);
    }
    if (filter.tier_id) {
      pageQuery = pageQuery.eq("tier_id", filter.tier_id);
    }

    const { data, error } = await pageQuery;
    if (error) {
      throw new Error(`Failed to resolve audience: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const m of data) {
      recipients.push({
        member_id: m.id,
        email: m.email,
        first_name: m.first_name,
        last_name: m.last_name,
      });
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const skipped = Math.max((totalInScope ?? recipients.length) - recipients.length, 0);
  return { recipients, skipped };
}
