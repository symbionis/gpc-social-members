import { createAdminClient } from "@/lib/supabase/admin";

const PAGE_SIZE = 1000; // Supabase default cap; paginate so a busy event isn't truncated.

export interface ReminderSummaryRow {
  days_before: number;
  slot: string;
  /** Number of attendees this (days_before, slot) reminder was delivered to. */
  recipient_count: number;
  /** Most recent send timestamp within the group (ISO). */
  last_sent_at: string;
}

interface SendRow {
  days_before: number;
  slot: string;
  sent_at: string;
}

/**
 * Summarise the automatic reminder emails already sent for an event, grouped by
 * (days_before, slot). Source of truth is `event_reminder_sends`, one row per
 * attendee per reminder, so the row count per group is the number reached.
 *
 * Ordered by days_before descending (earliest reminder first), then slot.
 */
export async function getEventReminderSummary(
  eventId: string
): Promise<ReminderSummaryRow[]> {
  const supabase = createAdminClient();

  const rows: SendRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("event_reminder_sends")
      .select("days_before, slot, sent_at")
      .eq("event_id", eventId)
      .order("sent_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load reminder sends: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as SendRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const groups = new Map<string, ReminderSummaryRow>();
  for (const r of rows) {
    const key = `${r.days_before}|${r.slot}`;
    const existing = groups.get(key);
    if (existing) {
      existing.recipient_count += 1;
      if (r.sent_at > existing.last_sent_at) existing.last_sent_at = r.sent_at;
    } else {
      groups.set(key, {
        days_before: r.days_before,
        slot: r.slot,
        recipient_count: 1,
        last_sent_at: r.sent_at,
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.days_before - a.days_before || a.slot.localeCompare(b.slot)
  );
}
