// Data layer for the printable "events flyer" — a one-page, GPC-branded listing
// of upcoming events an admin prints to PDF (browser "Save as PDF") to share in
// the members' WhatsApp group or pin up at the club. The flyer's job is to pull
// dormant members back into the portal, so it links/QRs to the member-events
// page, which redirects unauthenticated visitors to login.
//
// Stricter than the member-facing /events listing: that page shows any
// is_published event; the flyer additionally requires is_confirmed so a shared,
// printed artifact never leaks a tentative event.

import { createAdminClient } from "@/lib/supabase/admin";
import { nowInZurich } from "@/lib/format";
import { stripHtml } from "@/lib/broadcast/strip-html";

const DESCRIPTION_MAX = 160;

const DEFAULT_MEMBER_EVENTS_URL = "https://social.genevapolo.com/events";

// The QR/link target. A single known public URL — never derived from the
// request host, which on Railway can resolve to an internal 0.0.0.0 origin that
// would encode an unreachable QR. Overridable by env for non-prod environments.
export function getMemberEventsUrl(): string {
  return process.env.NEXT_PUBLIC_MEMBER_EVENTS_URL?.trim() || DEFAULT_MEMBER_EVENTS_URL;
}

export interface FlyerEvent {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD or null
  startTime: string | null; // "HH:MM[:SS]" Postgres time, wall-clock
  typeName: string | null;
  description: string; // shortened, plain text
  imageUrl: string | null; // hero/thumbnail image
}

// Hero image for an event — first non-empty entry in the images array, else the
// legacy single image fields. Mirrors heroImage() in MemberEventsGrid so the
// flyer thumbnail matches what members see in the portal.
export function heroImage(event: {
  images?: unknown;
  image_url?: string | null;
  image_url_2?: string | null;
}): string | null {
  if (Array.isArray(event.images)) {
    const first = event.images.find(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    if (first) return first;
  }
  return event.image_url || event.image_url_2 || null;
}

// Rich-text (Tiptap HTML) description → short plain-text snippet for the flyer.
// Reuses the shared stripHtml helper so tag handling matches the email channel.
export function shortenDescription(
  html: string | null | undefined,
  maxLen = DESCRIPTION_MAX,
): string {
  if (!html) return "";
  const text = stripHtml(html).replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

// "Upcoming" matches the admin EventManager isPast() logic: an event is upcoming
// while its end_date (or start_date when single-day) is today or later. This
// keeps an in-progress multi-day event on the flyer, unlike the member page's
// start_date-only cutoff.
export function isUpcoming(
  event: { start_date: string; end_date?: string | null },
  today: string,
): boolean {
  return (event.end_date || event.start_date) >= today;
}

interface EventRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  description: string | null;
  event_type_id: string | null;
  image_url: string | null;
  image_url_2: string | null;
  images: unknown;
}

// Confirmed + published + upcoming events, chronological, with type names
// resolved and descriptions shortened. Returns [] on query failure (the page
// renders an empty-state rather than crashing).
export async function getFlyerEvents(): Promise<FlyerEvent[]> {
  const admin = createAdminClient();
  const today = nowInZurich().date;

  const { data: rows, error } = await admin
    .from("events")
    .select(
      "id, title, start_date, end_date, start_time, description, event_type_id, image_url, image_url_2, images",
    )
    .eq("is_published", true)
    .eq("is_confirmed", true)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("[flyer] events query failed", error);
    return [];
  }

  const upcoming = ((rows ?? []) as EventRow[]).filter((e) => isUpcoming(e, today));

  const typeIds = [
    ...new Set(upcoming.map((e) => e.event_type_id).filter((id): id is string => !!id)),
  ];
  const typeNameById = new Map<string, string>();
  if (typeIds.length > 0) {
    const { data: types } = await admin
      .from("event_types")
      .select("id, name")
      .in("id", typeIds);
    for (const t of (types ?? []) as { id: string; name: string }[]) {
      typeNameById.set(t.id, t.name);
    }
  }

  return upcoming.map((e) => ({
    id: e.id,
    title: e.title,
    startDate: e.start_date,
    endDate: e.end_date,
    startTime: e.start_time,
    typeName: e.event_type_id ? typeNameById.get(e.event_type_id) ?? null : null,
    description: shortenDescription(e.description),
    imageUrl: heroImage(e),
  }));
}
