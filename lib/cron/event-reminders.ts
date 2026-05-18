import { createAdminClient } from "@/lib/supabase/admin";
import { sendEventReminder, type ReminderSlot } from "@/lib/email/event-reminder";
import { captureServerException } from "@/lib/analytics/server-errors";

const SLOTS: readonly ReminderSlot[] = ["morning", "lunch", "evening"];
const ZONE = "Europe/Zurich";
const WINDOW_DAYS = 60;

export interface EventReminderResult {
  sent: number;
  skipped: number;
  errors: number;
  reason?: string;
}

interface Preset {
  days_before: number;
  slot: ReminderSlot;
  enabled: boolean;
}

interface ScheduleEntry {
  days_before: number;
  slot: ReminderSlot;
}

interface SettingsValue {
  presets?: Preset[];
  slot_times?: Partial<Record<ReminderSlot, string>>;
}

interface EventRow {
  id: string;
  start_date: string;
  reminder_schedule: unknown;
}

interface RegistrationRow {
  id: string;
  event_id: string;
  status: string | null;
  created_at: string;
}

interface SentRow {
  registration_id: string;
  days_before: number;
  slot: string;
}

const DEFAULT_SLOT_HOURS: Record<ReminderSlot, number> = {
  morning: 8,
  lunch: 12,
  evening: 18,
};

function parseHour(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const [hStr] = value.split(":");
  const h = Number(hStr);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : fallback;
}

// Return the (date, hour) of "now" in Europe/Zurich without pulling in a
// date library. Intl gives us locale-shaped parts; we read them back as
// numbers. Cheap and DST-correct.
function nowInZurich(): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hourStr = get("hour");
  const hour = hourStr === "24" ? 0 : Number(hourStr);
  return { date: `${year}-${month}-${day}`, hour };
}

// Convert a Europe/Zurich-local (date, hour) to a UTC ISO instant for the
// registration created_at cutoff. Achieved by guessing UTC ± a window and
// reading back the zoned hour to lock onto the correct UTC value.
function zurichInstantToUtc(localDate: string, localHour: number): string {
  // Construct candidate UTC instant by treating local fields as UTC, then
  // adjusting by the observed offset for that instant.
  const naiveUtc = new Date(`${localDate}T${String(localHour).padStart(2, "0")}:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(naiveUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const seenAsZurichHour = get("hour") === "24" ? 0 : Number(get("hour"));
  const deltaHours = seenAsZurichHour - localHour;
  // Subtract delta — if we saw Zurich showing 10:00 for our 08:00Z guess,
  // the true 08:00 Zurich is 2h earlier in UTC.
  const adjusted = new Date(naiveUtc.getTime() - deltaHours * 3600 * 1000);
  return adjusted.toISOString();
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dedupeSchedule(items: ScheduleEntry[]): ScheduleEntry[] {
  const seen = new Set<string>();
  const out: ScheduleEntry[] = [];
  for (const it of items) {
    const key = `${it.days_before}|${it.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function isSlot(value: unknown): value is ReminderSlot {
  return typeof value === "string" && (SLOTS as readonly string[]).includes(value);
}

function parseEventSchedule(raw: unknown): ScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScheduleEntry[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      "days_before" in item &&
      "slot" in item
    ) {
      const d = Number((item as { days_before: unknown }).days_before);
      const s = (item as { slot: unknown }).slot;
      if (Number.isInteger(d) && d >= 0 && isSlot(s)) {
        out.push({ days_before: d, slot: s });
      }
    }
  }
  return out;
}

export async function runEventReminders(): Promise<EventReminderResult> {
  const supabase = createAdminClient();

  const { data: settingsRow, error: settingsErr } = await supabase
    .from("email_settings")
    .select("enabled, value")
    .eq("key", "event_reminder_default")
    .limit(1)
    .maybeSingle();

  if (settingsErr) {
    // Throw so withJobLogging records the failure and surfaces via Error Tracking
    // — a misconfigured DB must never silently disable reminders.
    throw settingsErr;
  }

  if (!settingsRow) {
    return { sent: 0, skipped: 0, errors: 0, reason: "settings_missing" };
  }

  if (!settingsRow.enabled) {
    return { sent: 0, skipped: 0, errors: 0, reason: "disabled" };
  }

  const settingsValue = (settingsRow.value ?? {}) as SettingsValue;
  const slotTimes = settingsValue.slot_times ?? {};
  const enabledPresets: ScheduleEntry[] = (settingsValue.presets ?? [])
    .filter((p) => p.enabled && isSlot(p.slot) && Number.isInteger(p.days_before) && p.days_before >= 0)
    .map((p) => ({ days_before: p.days_before, slot: p.slot }));

  const now = nowInZurich();
  const currentSlot = SLOTS.find(
    (slot) => parseHour(slotTimes[slot], DEFAULT_SLOT_HOURS[slot]) === now.hour
  );

  if (!currentSlot) {
    return { sent: 0, skipped: 0, errors: 0, reason: "not slot" };
  }

  const windowEnd = addDays(now.date, WINDOW_DAYS);

  const { data: events, error: eventsErr } = await supabase
    .from("events")
    .select("id, start_date, reminder_schedule")
    .eq("is_published", true)
    .eq("registration_enabled", true)
    .gte("start_date", now.date)
    .lte("start_date", windowEnd);

  if (eventsErr) {
    console.error("[event-reminders] events query failed", eventsErr);
    throw eventsErr;
  }

  if (!events || events.length === 0) {
    return { sent: 0, skipped: 0, errors: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const event of events as EventRow[]) {
    const perEvent = parseEventSchedule(event.reminder_schedule);
    const activeSchedule = dedupeSchedule([...enabledPresets, ...perEvent]);

    const dueTuples = activeSchedule.filter(
      (entry) =>
        entry.slot === currentSlot &&
        addDays(event.start_date, -entry.days_before) === now.date
    );

    if (dueTuples.length === 0) continue;

    const slotHour = parseHour(slotTimes[currentSlot], DEFAULT_SLOT_HOURS[currentSlot]);
    const firingInstantUtc = zurichInstantToUtc(now.date, slotHour);

    const { data: registrations, error: regErr } = await supabase
      .from("event_registrations")
      .select("id, event_id, status, created_at")
      .eq("event_id", event.id)
      .not("status", "in", "(cancelled,refunded)")
      .lte("created_at", firingInstantUtc);

    if (regErr) {
      console.error("[event-reminders] registrations query failed", event.id, regErr);
      captureServerException(regErr, { path: "cron/event-reminders/registrations", route_kind: event.id });
      errors++;
      continue;
    }

    if (!registrations || registrations.length === 0) continue;

    const regIds = (registrations as RegistrationRow[]).map((r) => r.id);
    const { data: sentRows, error: sentErr } = await supabase
      .from("event_reminder_sends")
      .select("registration_id, days_before, slot")
      .eq("event_id", event.id)
      .in("registration_id", regIds);

    if (sentErr) {
      console.error("[event-reminders] sent-rows query failed", event.id, sentErr);
      captureServerException(sentErr, { path: "cron/event-reminders/sent-rows", route_kind: event.id });
      errors++;
      continue;
    }

    const sentKeys = new Set(
      ((sentRows ?? []) as SentRow[]).map(
        (r) => `${r.registration_id}|${r.days_before}|${r.slot}`
      )
    );

    for (const tuple of dueTuples) {
      for (const registration of registrations as RegistrationRow[]) {
        const key = `${registration.id}|${tuple.days_before}|${tuple.slot}`;
        if (sentKeys.has(key)) {
          skipped++;
          continue;
        }

        const result = await sendEventReminder(
          registration.id,
          event.id,
          tuple.days_before,
          tuple.slot
        );

        if (!result.success) {
          captureServerException(result.error ?? new Error("event reminder send failed"), {
            path: "cron/event-reminders/send",
            route_kind: `${event.id}|${tuple.days_before}|${tuple.slot}`,
            distinct_id: registration.id,
          });
          errors++;
          continue;
        }

        const { error: insertErr } = await supabase
          .from("event_reminder_sends")
          .insert({
            event_id: event.id,
            registration_id: registration.id,
            days_before: tuple.days_before,
            slot: tuple.slot,
          });

        if (insertErr) {
          const isDuplicate = (insertErr as { code?: string }).code === "23505";
          if (isDuplicate) {
            // Concurrent tick already recorded the send. Email went out once
            // (this code path) and the other tick's email also went out — rare
            // race window. Classify as skipped rather than error so operators
            // can tell a race apart from a real failure.
            console.warn(
              "[event-reminders] idempotency duplicate (concurrent tick)",
              { event_id: event.id, registration_id: registration.id, tuple }
            );
            skipped++;
            continue;
          }
          console.error(
            "[event-reminders] idempotency insert failed",
            { event_id: event.id, registration_id: registration.id, tuple, error: insertErr }
          );
          captureServerException(insertErr, {
            path: "cron/event-reminders/idempotency-insert",
            route_kind: `${event.id}|${tuple.days_before}|${tuple.slot}`,
            distinct_id: registration.id,
          });
          errors++;
          continue;
        }

        sent++;
      }
    }
  }

  return { sent, skipped, errors };
}
