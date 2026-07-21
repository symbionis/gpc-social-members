// Add-to-calendar link for the guest manage page (U10, R17). A single Google Calendar
// "add event" URL built from the event fields — no file download, works on desktop and
// mobile. Times are floating local (we don't store a timezone); when the event has no
// start_time it becomes an all-day entry.

export interface CalendarEvent {
  title: string;
  startDate: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM[:SS] or null
  endDate: string | null; // YYYY-MM-DD or null
  location: string | null;
  description: string | null;
}

function stamp(d: Date, allDay: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  if (allDay) return date;
  return `${date}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * A Google Calendar "add event" URL, or null when the start date is unusable.
 * Timed events default to a 2-hour block; all-day events span start → next day
 * (Google treats the all-day end as exclusive).
 */
export function googleCalendarUrl(event: CalendarEvent): string | null {
  const allDay = !event.startTime;
  const start = new Date(`${event.startDate}T${event.startTime ?? "00:00"}:00`);
  if (Number.isNaN(start.getTime())) return null;

  let end: Date;
  if (allDay) {
    const base = event.endDate ? new Date(`${event.endDate}T00:00:00`) : start;
    end = new Date((Number.isNaN(base.getTime()) ? start : base).getTime() + 24 * 60 * 60 * 1000);
  } else {
    end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  }

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stamp(start, allDay)}/${stamp(end, allDay)}`,
  });
  if (event.location) params.set("location", event.location);
  if (event.description) params.set("details", event.description);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
