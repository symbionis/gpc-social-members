"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { SeatState } from "@/lib/events/seat-usage";
import SeatBadges from "@/components/events/SeatBadges";

export interface MemberEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  location: string | null;
  description: string | null;
  image_url: string | null;
  image_url_2: string | null;
  images: unknown;
  visibility: string | null;
  is_confirmed: boolean | null;
  event_type_id: string | null;
  registration_enabled: boolean | null;
  seat_cap: number | null;
}

export interface MemberEventType {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface Props {
  events: MemberEvent[];
  eventTypes: MemberEventType[];
  showFilters?: boolean;
  /** Per-event seat state for capped events. Uncapped events omitted. */
  seatStateByEvent?: Record<string, SeatState>;
}

function formatDateRange(startDate: string, endDate: string | null): string {
  const start = new Date(startDate);
  const startDay = start.getDate();
  const startMonth = start.toLocaleDateString("en-GB", { month: "long" });
  const startYear = start.getFullYear();
  if (!endDate || endDate === startDate) {
    return `${startDay} ${startMonth} ${startYear}`;
  }
  const end = new Date(endDate);
  const endDay = end.getDate();
  const endMonth = end.toLocaleDateString("en-GB", { month: "long" });
  const endYear = end.getFullYear();
  if (startMonth === endMonth && startYear === endYear) {
    return `${startDay}–${endDay} ${startMonth} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${startYear}`;
  }
  return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
}

function heroImage(event: MemberEvent): string | null {
  if (Array.isArray(event.images)) {
    const first = event.images.find(
      (u): u is string => typeof u === "string" && u.length > 0
    );
    if (first) return first;
  }
  return event.image_url || event.image_url_2 || null;
}

export default function MemberEventsGrid({
  events,
  eventTypes,
  showFilters = true,
  seatStateByEvent = {},
}: Props) {
  const [activeType, setActiveType] = useState<string>("all");

  const filtered = useMemo(() => {
    if (activeType === "all") return events;
    return events.filter((e) => e.event_type_id === activeType);
  }, [events, activeType]);

  const typeMap = useMemo(() => {
    const m = new Map<string, MemberEventType>();
    for (const t of eventTypes) m.set(t.id, t);
    return m;
  }, [eventTypes]);

  return (
    <div>
      {showFilters && eventTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <FilterButton
            active={activeType === "all"}
            onClick={() => setActiveType("all")}
            label="All"
          />
          {eventTypes.map((t) => (
            <FilterButton
              key={t.id}
              active={activeType === t.id}
              onClick={() => setActiveType(t.id)}
              label={t.name}
              color={t.color}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <p className="text-muted-foreground font-body">
            No events scheduled at the moment. Check back soon.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((event) => {
            const eventType = event.event_type_id
              ? typeMap.get(event.event_type_id)
              : undefined;
            return (
              <EventCard
                key={event.id}
                event={event}
                eventType={eventType}
                seatState={seatStateByEvent[event.id]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-body font-medium border transition-colors ${
        active
          ? "bg-marine text-white border-marine"
          : "bg-white text-marine border-border hover:border-sky/50"
      }`}
    >
      {color && (
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </button>
  );
}

function EventCard({
  event,
  eventType,
  seatState,
}: {
  event: MemberEvent;
  eventType?: MemberEventType;
  seatState: SeatState | undefined;
}) {
  const dateLabel = formatDateRange(event.start_date, event.end_date);
  const hero = heroImage(event);

  return (
    <Link
      href={`/events/${event.id}`}
      className="bg-white rounded-sm border border-border/60 overflow-hidden flex flex-col hover:border-sky/50 hover:shadow-sm transition-all"
    >
      {hero ? (
        <div className="aspect-square bg-cream/50">
          <img
            src={hero}
            alt={event.title}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="aspect-square bg-cream/60" />
      )}
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          {eventType && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-body bg-marine/5 text-marine">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: eventType.color }}
              />
              {eventType.name}
            </span>
          )}
          {event.is_confirmed === false && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-amber-100 text-amber-800">
              Dates TBC
            </span>
          )}
          <SeatBadges
            registrationEnabled={event.registration_enabled}
            seatState={seatState}
          />
        </div>
        <p className="font-body text-sm font-semibold text-sky-dark">
          {dateLabel}
          {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ""}
        </p>
        <h3 className="font-heading text-lg font-bold text-marine mt-1">
          {event.title}
        </h3>
        {event.location && (
          <p className="text-sm font-body text-muted-foreground mt-1">
            {event.location}
          </p>
        )}
        {event.description && (
          <p className="text-sm font-body text-muted-foreground mt-2 line-clamp-3">
            {event.description}
          </p>
        )}
        <div className="mt-auto pt-3">
          <span className="inline-block text-xs font-body font-medium text-marine underline underline-offset-4">
            View event →
          </span>
        </div>
      </div>
    </Link>
  );
}
