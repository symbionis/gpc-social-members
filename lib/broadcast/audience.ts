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
  const tierIds = (filter.tier_ids ?? []).filter((t) => t && t.length > 0);
  let totalQuery = supabase
    .from("members")
    .select("id", { count: "exact", head: true });
  if (filter.status !== "all") {
    totalQuery = totalQuery.eq("status", filter.status);
  }
  if (tierIds.length > 0) {
    totalQuery = totalQuery.in("tier_id", tierIds);
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
      .select("id, email, first_name, last_name, membership_tiers(name)")
      .eq("marketing_consent", true)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (filter.status !== "all") {
      pageQuery = pageQuery.eq("status", filter.status);
    }
    if (tierIds.length > 0) {
      pageQuery = pageQuery.in("tier_id", tierIds);
    }

    const { data, error } = await pageQuery;
    if (error) {
      throw new Error(`Failed to resolve audience: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const m of data) {
      const raw = (m as {
        membership_tiers?: { name: string } | { name: string }[] | null;
      }).membership_tiers;
      const tier = Array.isArray(raw) ? raw[0] : raw;
      recipients.push({
        member_id: m.id,
        email: m.email,
        first_name: m.first_name,
        last_name: m.last_name,
        tier_name: tier?.name ?? null,
      });
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const skipped = Math.max((totalInScope ?? recipients.length) - recipients.length, 0);
  return { recipients, skipped };
}

export interface AudienceCounts {
  recipient_count: number;
  skipped_count: number;
  per_tier: Array<{ tier_name: string | null; count: number }>;
}

/**
 * Count-only audience preview for the agent surface.
 *
 * Uses head-only Supabase queries (`count: "exact", head: true`) so no
 * recipient rows — and crucially no email or name columns — are ever
 * loaded into the server process. Strictly fewer side channels than
 * resolveAudience() for use cases that only need numbers.
 *
 * Issues 2 + N + 1 head-only queries where N = number of active tiers
 * (typically ~5). Latency is comparable to a single resolveAudience() call
 * because every query is row-less and runs against the same indexes.
 */
export async function previewAudienceCounts(
  filter: AudienceFilter
): Promise<AudienceCounts> {
  const supabase = createAdminClient();
  const tierIds = (filter.tier_ids ?? []).filter((t) => t && t.length > 0);

  // 1. Total in scope (status + tier), regardless of consent.
  let totalQuery = supabase
    .from("members")
    .select("id", { count: "exact", head: true });
  if (filter.status !== "all") totalQuery = totalQuery.eq("status", filter.status);
  if (tierIds.length > 0) totalQuery = totalQuery.in("tier_id", tierIds);
  const { count: totalInScope, error: totalErr } = await totalQuery;
  if (totalErr) {
    throw new Error(`Failed to count audience: ${totalErr.message}`);
  }

  // 2. Consenting in scope (= recipient count).
  let consentingQuery = supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("marketing_consent", true);
  if (filter.status !== "all")
    consentingQuery = consentingQuery.eq("status", filter.status);
  if (tierIds.length > 0)
    consentingQuery = consentingQuery.in("tier_id", tierIds);
  const { count: recipientCount, error: consentingErr } = await consentingQuery;
  if (consentingErr) {
    throw new Error(`Failed to count audience: ${consentingErr.message}`);
  }

  // 3. Per-tier counts. We need to enumerate the relevant tiers — either
  //    the explicit filter list, or all active tiers when the filter is
  //    open. For each, run a head-only count of consenting members.
  let tierRows: Array<{ id: string; name: string }> = [];
  if (tierIds.length > 0) {
    const { data, error } = await supabase
      .from("membership_tiers")
      .select("id, name")
      .in("id", tierIds);
    if (error) throw new Error(`Failed to load tier names: ${error.message}`);
    tierRows = data ?? [];
  } else {
    const { data, error } = await supabase
      .from("membership_tiers")
      .select("id, name")
      .eq("is_active", true);
    if (error) throw new Error(`Failed to load tier names: ${error.message}`);
    tierRows = data ?? [];
  }

  const perTier = await Promise.all(
    tierRows.map(async (t) => {
      let q = supabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("marketing_consent", true)
        .eq("tier_id", t.id);
      if (filter.status !== "all") q = q.eq("status", filter.status);
      const { count, error } = await q;
      if (error) {
        throw new Error(
          `Failed to count tier ${t.name}: ${error.message}`
        );
      }
      return { tier_name: t.name, count: count ?? 0 };
    })
  );

  // Members with tier_id IS NULL — only meaningful when the filter is open.
  let nullTierCount = 0;
  if (tierIds.length === 0) {
    let q = supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("marketing_consent", true)
      .is("tier_id", null);
    if (filter.status !== "all") q = q.eq("status", filter.status);
    const { count, error } = await q;
    if (error) {
      throw new Error(`Failed to count untiered members: ${error.message}`);
    }
    nullTierCount = count ?? 0;
  }

  const perTierFiltered = perTier.filter((t) => t.count > 0);
  const tail =
    nullTierCount > 0
      ? [{ tier_name: null as string | null, count: nullTierCount }]
      : [];
  const perTierSorted = [...perTierFiltered, ...tail].sort(
    (a, b) => b.count - a.count
  );

  return {
    recipient_count: recipientCount ?? 0,
    skipped_count: Math.max(
      (totalInScope ?? 0) - (recipientCount ?? 0),
      0
    ),
    per_tier: perTierSorted,
  };
}
