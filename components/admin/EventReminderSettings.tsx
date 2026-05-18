"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Slot = "morning" | "lunch" | "evening";

interface Preset {
  days_before: number;
  slot: Slot;
  enabled: boolean;
}

interface SettingsValue {
  presets: Preset[];
  slot_times: Record<Slot, string>;
}

interface Props {
  initialEnabled: boolean;
  initialValue: SettingsValue;
}

const SLOT_KEYS: Slot[] = ["morning", "lunch", "evening"];

// Find the preset row matching (days_before, slot) — used to keep the two
// named presets in known positions while still treating them as data.
function findPresetIndex(presets: Preset[], days_before: number, slot: Slot): number {
  return presets.findIndex(
    (p) => p.days_before === days_before && p.slot === slot
  );
}

export default function EventReminderSettings({
  initialEnabled,
  initialValue,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [value, setValue] = useState<SettingsValue>(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const morningBeforeIdx = findPresetIndex(value.presets, 1, "morning");
  const morningOfIdx = findPresetIndex(value.presets, 0, "morning");

  async function persist(next: { enabled?: boolean; value?: SettingsValue }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/email-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "event_reminder_default",
          enabled: next.enabled ?? enabled,
          value: next.value ?? value,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      // Revert local state on failure so the UI reflects what's persisted
      setEnabled(initialEnabled);
      setValue(initialValue);
    } finally {
      setSaving(false);
    }
  }

  function togglePreset(idx: number, checked: boolean) {
    if (idx < 0) return;
    const nextPresets = value.presets.map((p, i) =>
      i === idx ? { ...p, enabled: checked } : p
    );
    const next: SettingsValue = { ...value, presets: nextPresets };
    setValue(next);
    void persist({ value: next });
  }

  function toggleMaster(checked: boolean) {
    setEnabled(checked);
    void persist({ enabled: checked });
  }

  function changeSlotTime(slot: Slot, time: string) {
    const next: SettingsValue = {
      ...value,
      slot_times: { ...value.slot_times, [slot]: time },
    };
    setValue(next);
  }

  function commitSlotTimes() {
    void persist({ value });
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-body font-semibold text-marine mb-1">
            Event Reminder Defaults
          </h3>
          <p className="text-xs text-muted-foreground font-body">
            Global presets and slot times for the event reminder cron. Per-event
            extras layer on top from the event editor.
          </p>
        </div>
        <label className="flex items-center gap-2 shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => toggleMaster(e.target.checked)}
          />
          <span className="text-sm font-body text-marine">
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Preset toggles */}
        <div>
          <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-2">
            Presets
          </p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-body text-marine">
              <input
                type="checkbox"
                checked={
                  morningBeforeIdx >= 0
                    ? value.presets[morningBeforeIdx].enabled
                    : false
                }
                disabled={saving || morningBeforeIdx < 0}
                onChange={(e) =>
                  togglePreset(morningBeforeIdx, e.target.checked)
                }
              />
              Morning before the event (1 day before, morning slot)
            </label>
            <label className="flex items-center gap-2 text-sm font-body text-marine">
              <input
                type="checkbox"
                checked={
                  morningOfIdx >= 0 ? value.presets[morningOfIdx].enabled : false
                }
                disabled={saving || morningOfIdx < 0}
                onChange={(e) => togglePreset(morningOfIdx, e.target.checked)}
              />
              Morning of the event (same day, morning slot)
            </label>
          </div>
        </div>

        {/* Slot times */}
        <div>
          <p className="text-xs text-muted-foreground font-body uppercase tracking-wide mb-2">
            Slot times (Europe/Zurich)
          </p>
          <div className="space-y-2">
            {SLOT_KEYS.map((slot) => (
              <label
                key={slot}
                className="flex items-center justify-between gap-2 text-sm font-body text-marine"
              >
                <span className="capitalize">{slot}</span>
                <input
                  type="time"
                  step="3600"
                  value={value.slot_times[slot] || ""}
                  disabled={saving}
                  onChange={(e) => changeSlotTime(slot, e.target.value)}
                  onBlur={commitSlotTimes}
                  className="px-3 py-1.5 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground font-body mt-2">
            Cron fires hourly; reminders go out at the matching slot hour.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm font-body text-red-600 mt-3">Error: {error}</p>
      )}
    </div>
  );
}
