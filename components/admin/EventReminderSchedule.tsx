"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import TestReminderButton from "./TestReminderButton";
import type {
  ReminderEntry,
  ReminderSlot,
} from "@/lib/events/reminder-schedule";

const REMINDER_SLOTS: ReminderSlot[] = ["morning", "lunch", "evening"];

interface Props {
  eventId: string;
  /** Current per-event schedule (events.reminder_schedule), already validated. */
  schedule: ReminderEntry[];
}

// Dedupe by (days_before, slot) so the same reminder can't be added twice.
function dedupe(entries: ReminderEntry[]): ReminderEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.days_before}|${e.slot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const inputClass =
  "px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

export default function EventReminderSchedule({ eventId, schedule }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<ReminderEntry[]>(schedule);
  // Baseline of the last saved value; the editor is dirty when it diverges.
  const [saved, setSaved] = useState(() => JSON.stringify(schedule));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(rows) !== saved;

  function patch(next: ReminderEntry[]) {
    setRows(next);
    setJustSaved(false);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminder_schedule: rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save the reminder schedule. Try again.");
        return;
      }
      setSaved(JSON.stringify(rows));
      setJustSaved(true);
      try {
        posthog.capture("event_reminder_schedule_saved", {
          event_id: eventId,
          entry_count: rows.length,
        });
      } catch {
        /* posthog not initialized — ignore */
      }
      router.refresh();
    } catch {
      setError("Network error. Could not save the reminder schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h3 className="font-body font-semibold text-marine mb-1">
        Scheduled reminders
      </h3>
      <p className="text-xs text-muted-foreground font-body mb-3">
        Layered on top of the global presets (configured in Scheduled Jobs).
        Each entry: how many days before the event, at which slot.
      </p>

      <div className="mb-4">
        <TestReminderButton eventId={eventId} schedule={rows} />
      </div>

      <div className="space-y-2">
        {rows.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="60"
              step="1"
              value={entry.days_before}
              onChange={(e) => {
                const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                patch(rows.map((r, i) => (i === idx ? { ...r, days_before: v } : r)));
              }}
              className={`${inputClass} w-24`}
            />
            <span className="text-xs text-muted-foreground font-body shrink-0">
              day(s) before,
            </span>
            <select
              value={entry.slot}
              onChange={(e) =>
                patch(
                  rows.map((r, i) =>
                    i === idx ? { ...r, slot: e.target.value as ReminderSlot } : r
                  )
                )
              }
              className={`${inputClass} w-32`}
            >
              {REMINDER_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => patch(rows.filter((_, i) => i !== idx))}
              className="px-2 py-1 text-sm font-body text-muted-foreground hover:text-red-600"
              aria-label="Remove reminder"
            >
              ×
            </button>
          </div>
        ))}

        {rows.length === 0 && (
          <p className="text-sm font-body text-muted-foreground">
            No extra reminders — only the global presets will be sent.
          </p>
        )}

        <button
          type="button"
          onClick={() =>
            patch(dedupe([...rows, { days_before: 3, slot: "morning" }]))
          }
          className="px-3 py-1.5 text-sm font-body text-marine border border-border rounded-lg hover:bg-cream transition-colors"
        >
          + Add reminder
        </button>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
        {justSaved && !dirty && (
          <span className="text-sm font-body text-emerald-700">Saved</span>
        )}
      </div>

      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
    </section>
  );
}
