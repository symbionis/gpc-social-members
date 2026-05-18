"use client";

import { useState } from "react";
import posthog from "posthog-js";

type Slot = "morning" | "lunch" | "evening";
interface ReminderEntry {
  days_before: number;
  slot: Slot;
}

interface Props {
  eventId: string;
  schedule: ReminderEntry[];
}

// Shape options as "Tomorrow morning", "Today morning", "3 days before evening", etc.
function labelFor(entry: ReminderEntry): string {
  if (entry.days_before === 0) return `Same day, ${entry.slot}`;
  if (entry.days_before === 1) return `1 day before, ${entry.slot}`;
  return `${entry.days_before} days before, ${entry.slot}`;
}

export default function TestReminderButton({ eventId, schedule }: Props) {
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<string>(() => {
    if (schedule.length === 0) return "1|morning";
    const first = schedule[0];
    return `${first.days_before}|${first.slot}`;
  });

  // Always include the two global presets as picker options so admins can
  // preview the global behavior even if no per-event extras are configured.
  const options: ReminderEntry[] = [];
  const seen = new Set<string>();
  for (const e of [
    { days_before: 1, slot: "morning" as Slot },
    { days_before: 0, slot: "morning" as Slot },
    ...schedule,
  ]) {
    const key = `${e.days_before}|${e.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(e);
  }

  async function handleSend() {
    setSending(true);
    const [daysStr, slot] = picked.split("|");
    const days_before = Number(daysStr);

    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/send-test-reminder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days_before, slot }),
        }
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = body?.error || `HTTP ${res.status}`;
        try {
          posthog.capture("event_test_reminder_failed", {
            event_id: eventId,
            days_before,
            slot,
            error: message,
          });
        } catch {
          /* posthog not initialized */
        }
        alert(`Test reminder failed: ${message}`);
        return;
      }

      try {
        posthog.capture("event_test_reminder_sent", {
          event_id: eventId,
          days_before,
          slot,
        });
      } catch {
        /* posthog not initialized */
      }
      alert("Test reminder sent — check your inbox.");
    } catch (e) {
      alert(
        `Network error: ${e instanceof Error ? e.message : "unknown"}`
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center gap-2 p-3 bg-cream rounded-lg border border-border">
      <span className="text-xs font-body text-marine">Preview reminder:</span>
      <select
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        disabled={sending}
        className="px-2 py-1 rounded border border-border bg-white text-marine font-body text-xs focus:outline-none focus:ring-2 focus:ring-sky/50"
      >
        {options.map((e) => (
          <option
            key={`${e.days_before}|${e.slot}`}
            value={`${e.days_before}|${e.slot}`}
          >
            {labelFor(e)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleSend}
        disabled={sending}
        className="px-3 py-1.5 text-xs font-body font-medium text-marine border border-marine rounded hover:bg-marine hover:text-white transition-colors disabled:opacity-50"
      >
        {sending ? "Sending..." : "Send test to my email"}
      </button>
    </div>
  );
}
