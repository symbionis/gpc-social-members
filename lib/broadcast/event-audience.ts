import { createAdminClient } from "@/lib/supabase/admin";
import type { BroadcastRecipient } from "@/lib/broadcast/types";

const PAGE_SIZE = 1000; // Supabase default cap; we paginate to bypass it.

/** Registration statuses that count as "attending" for a pre-event message.
 *  Mirrors the attendees admin page so the messaged set equals the displayed
 *  list (cancelled/refunded excluded). */
const ACTIVE_REGISTRATION_STATUSES = ["paid", "free"] as const;

export type EventMessageKind = "event_pre" | "event_post";

export interface ResolveEventAudienceInput {
  event_id: string;
  kind: EventMessageKind;
  /** Honored only for `event_post`: when true, include checked-in attendees
   *  who did not opt in to marketing at the door (transactional override). */
  include_non_consented?: boolean;
}

export interface ResolvedEventAudience {
  recipients: BroadcastRecipient[];
  /** Post-event with the override off: distinct attendees excluded by consent.
   *  Pre-event: always 0 (no consent filter applies). */
  skipped: number;
}

/** Split a single `name` column into a best-effort first/last for the template
 *  greeting. Event tables store one `name`, not first/last. */
function splitName(name: string | null): { first_name: string; last_name: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { first_name: "", last_name: "" };
  const [first, ...rest] = trimmed.split(/\s+/);
  return { first_name: first, last_name: rest.join(" ") };
}

interface AudienceRow {
  email: string | null;
  name: string | null;
  member_id: string | null;
  marketing_consent?: boolean | null;
}

function toRecipient(row: AudienceRow): BroadcastRecipient {
  return {
    member_id: row.member_id ?? null,
    email: (row.email ?? "").trim(),
    ...splitName(row.name),
    tier_name: null,
  };
}

/**
 * Resolve the recipient list for an event message.
 *
 * Pre-event (`event_pre`) → registered attendees (status paid/free), no consent
 * filter (transactional). Post-event (`event_post`) → checked-in attendees,
 * filtered to those who opted in at the door unless `include_non_consented` is
 * set; `marketing_consent = null` is treated as not-consented.
 *
 * Both audiences are paginated past Supabase's 1000-row cap and de-duplicated
 * by lowercased email so no one is emailed twice (neither source table
 * enforces email uniqueness for registrations).
 */
export async function resolveEventAudience(
  input: ResolveEventAudienceInput
): Promise<ResolvedEventAudience> {
  const supabase = createAdminClient();
  const rows =
    input.kind === "event_pre"
      ? await fetchRegistrations(supabase, input.event_id)
      : await fetchCheckins(supabase, input.event_id);

  if (input.kind === "event_pre") {
    return dedupe(rows, () => true);
  }

  const includeNonConsented = input.include_non_consented ?? false;
  return dedupe(rows, (row) => includeNonConsented || row.marketing_consent === true);
}

/** De-duplicate by lowercased email, keeping the first row per address.
 *  `include` decides whether a row is a recipient; rows that fail `include`
 *  and never appear as an included address are counted as `skipped`. */
function dedupe(
  rows: AudienceRow[],
  include: (row: AudienceRow) => boolean
): ResolvedEventAudience {
  const included = new Map<string, BroadcastRecipient>();
  const excluded = new Set<string>();
  for (const row of rows) {
    const key = (row.email ?? "").trim().toLowerCase();
    if (!key) continue;
    if (include(row)) {
      if (!included.has(key)) included.set(key, toRecipient(row));
    } else {
      excluded.add(key);
    }
  }
  for (const key of included.keys()) excluded.delete(key);
  return { recipients: [...included.values()], skipped: excluded.size };
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function fetchRegistrations(
  supabase: AdminClient,
  eventId: string
): Promise<AudienceRow[]> {
  const out: AudienceRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("event_registrations")
      .select("email, name, member_id")
      .eq("event_id", eventId)
      .in("status", [...ACTIVE_REGISTRATION_STATUSES])
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to resolve registrations: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as AudienceRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/** Post-event recipients are the checked-in attendees on the roster
 *  (`event_attendees.checked_in_at IS NOT NULL`) — event_checkins is frozen and
 *  no longer written, so reading it here would resolve to zero post-cutover.
 *  Marketing-consent and dedupe semantics are unchanged: the consent filter and
 *  the lowercased-email dedupe both run in `resolveEventAudience`/`dedupe`, and
 *  rows without an email are dropped there (no email = no destination). */
async function fetchCheckins(
  supabase: AdminClient,
  eventId: string
): Promise<AudienceRow[]> {
  const out: AudienceRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("event_attendees")
      .select("email, name, member_id, marketing_consent")
      .eq("event_id", eventId)
      .not("checked_in_at", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to resolve check-ins: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as AudienceRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}
