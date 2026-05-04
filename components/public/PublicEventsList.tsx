"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

const APPLY_URL = "/apply/GPC-2026";

export interface PublicEvent {
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
  registration_enabled: boolean | null;
  visibility: string | null;
  event_type_id: string | null;
}

export interface PublicEventType {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface Props {
  events: PublicEvent[];
  eventTypes: PublicEventType[];
}

function formatExactDate(startDate: string, endDate: string | null): string {
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

function formatMonthOnly(startDate: string, endDate: string | null): string {
  const start = new Date(startDate);
  const startMonth = start.toLocaleDateString("en-GB", { month: "long" });
  const startYear = start.getFullYear();
  if (!endDate || endDate === startDate) {
    return `${startMonth} ${startYear}`;
  }
  const end = new Date(endDate);
  const endMonth = end.toLocaleDateString("en-GB", { month: "long" });
  const endYear = end.getFullYear();
  if (startMonth === endMonth && startYear === endYear) {
    return `${startMonth} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} – ${endMonth} ${startYear}`;
  }
  return `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
}

function heroImage(event: PublicEvent): string | null {
  if (Array.isArray(event.images)) {
    const first = event.images.find(
      (u): u is string => typeof u === "string" && u.length > 0
    );
    if (first) return first;
  }
  return event.image_url || event.image_url_2 || null;
}

export default function PublicEventsList({ events, eventTypes }: Props) {
  const [activeType, setActiveType] = useState<string>("all");

  const filtered = useMemo(() => {
    if (activeType === "all") return events;
    return events.filter((e) => e.event_type_id === activeType);
  }, [events, activeType]);

  const typeMap = useMemo(() => {
    const m = new Map<string, PublicEventType>();
    for (const t of eventTypes) m.set(t.id, t);
    return m;
  }, [eventTypes]);

  return (
    <div>
      {/* Type filter buttons */}
      {eventTypes.length > 0 && (
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
            const isMembersOnly = event.visibility !== "public";
            const eventType = event.event_type_id ? typeMap.get(event.event_type_id) : undefined;
            return (
              <EventCard
                key={event.id}
                event={event}
                eventType={eventType}
                isMembersOnly={isMembersOnly}
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
  isMembersOnly,
}: {
  event: PublicEvent;
  eventType?: PublicEventType;
  isMembersOnly: boolean;
}) {
  const dateLabel = isMembersOnly
    ? formatMonthOnly(event.start_date, event.end_date)
    : formatExactDate(event.start_date, event.end_date);
  const hero = heroImage(event);

  const cta = isMembersOnly ? (
    <Link
      href={APPLY_URL}
      className="inline-block mt-4 text-xs font-body font-medium text-marine underline underline-offset-4 hover:text-sky-dark transition-colors"
    >
      Apply for membership →
    </Link>
  ) : (
    <Link
      href={`/public/events/${event.id}`}
      className="inline-block mt-4 text-xs font-body font-medium text-marine underline underline-offset-4 hover:text-sky-dark transition-colors"
    >
      View event →
    </Link>
  );

  return (
    <article className="bg-white rounded-sm border border-border/60 overflow-hidden flex flex-col">
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
          {isMembersOnly && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body font-medium bg-sky/10 text-sky-dark">
              Members only
            </span>
          )}
        </div>
        <p className="font-body text-sm font-semibold text-sky-dark">
          {dateLabel}
          {!isMembersOnly && event.start_time
            ? ` · ${event.start_time.slice(0, 5)}`
            : ""}
        </p>
        <h3 className="font-heading text-lg font-bold text-marine mt-1">
          {event.title}
        </h3>
        {!isMembersOnly && event.location && (
          <p className="text-sm font-body text-muted-foreground mt-1">
            {event.location}
          </p>
        )}
        {event.description && (
          <p className="text-sm font-body text-muted-foreground mt-2 line-clamp-3">
            {event.description}
          </p>
        )}
        <div className="mt-auto">{cta}</div>
      </div>
    </article>
  );
}
