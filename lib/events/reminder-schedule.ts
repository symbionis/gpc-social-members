// Shared validation for the events.reminder_schedule jsonb column.
//
// Wire format from the admin client is an array of { days_before, slot }.
// This module normalizes, validates, and dedupes before insertion. The DB
// only enforces "is an array"; this is the per-element contract.

export type ReminderSlot = "morning" | "lunch" | "evening";

export interface ReminderEntry {
  days_before: number;
  slot: ReminderSlot;
}

const SLOTS: readonly ReminderSlot[] = ["morning", "lunch", "evening"];

function isSlot(value: unknown): value is ReminderSlot {
  return typeof value === "string" && (SLOTS as readonly string[]).includes(value);
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  value?: ReminderEntry[];
}

/**
 * Validate, normalize, and dedupe the wire-format reminder schedule.
 * Returns the cleaned array or a 400-shaped error.
 */
export function validateReminderSchedule(raw: unknown): ValidationResult {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "reminder_schedule must be an array" };
  }

  const seen = new Set<string>();
  const out: ReminderEntry[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "reminder_schedule entries must be objects" };
    }
    const obj = item as Record<string, unknown>;
    const d = Number(obj.days_before);
    if (!Number.isInteger(d) || d < 0) {
      return {
        ok: false,
        error: "reminder_schedule.days_before must be a non-negative integer",
      };
    }
    if (!isSlot(obj.slot)) {
      return {
        ok: false,
        error: `reminder_schedule.slot must be one of: ${SLOTS.join(", ")}`,
      };
    }
    const key = `${d}|${obj.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ days_before: d, slot: obj.slot });
  }

  return { ok: true, value: out };
}
