"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EventType {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

interface Season {
  id: string;
  year: number;
}

interface Event {
  id: string;
  title: string;
  event_type_id: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  location: string | null;
  description: string | null;
  is_confirmed: boolean;
  is_published: boolean;
  notes: string | null;
  season_id: string | null;
}

interface EventManagerProps {
  events: Event[];
  eventTypes: EventType[];
  seasons: Season[];
}

const emptyForm = {
  title: "",
  event_type_id: "",
  start_date: "",
  end_date: "",
  start_time: "",
  location: "",
  description: "",
  is_confirmed: false,
  is_published: false,
  notes: "",
  season_id: "",
};

export default function EventManager({
  events,
  eventTypes,
  seasons,
}: EventManagerProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<
    "all" | "confirmed" | "unconfirmed"
  >("all");

  function getEventType(id: string | null): EventType | undefined {
    return eventTypes.find((t) => t.id === id);
  }

  function getSeason(id: string | null): Season | undefined {
    return seasons.find((s) => s.id === id);
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function startCreate() {
    setFormData(emptyForm);
    setEditing(null);
    setShowForm(true);
  }

  function startEdit(event: Event) {
    setFormData({
      title: event.title,
      event_type_id: event.event_type_id || "",
      start_date: event.start_date,
      end_date: event.end_date || "",
      start_time: event.start_time || "",
      location: event.location || "",
      description: event.description || "",
      is_confirmed: event.is_confirmed,
      is_published: event.is_published,
      notes: event.notes || "",
      season_id: event.season_id || "",
    });
    setEditing(event.id);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditing(null);
    setFormData(emptyForm);
  }

  async function handleSubmit() {
    if (!formData.title || !formData.start_date) return;

    setSaving(true);
    const endpoint = editing
      ? "/api/admin/events/update"
      : "/api/admin/events/create";

    const body = editing
      ? { event_id: editing, ...formData }
      : { ...formData };

    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    setShowForm(false);
    setEditing(null);
    setFormData(emptyForm);
    router.refresh();
  }

  async function handleDelete(eventId: string) {
    if (!window.confirm("Are you sure you want to delete this event?")) return;

    await fetch("/api/admin/events/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId }),
    });

    router.refresh();
  }

  const filteredEvents = events.filter((event) => {
    if (filterType !== "all" && event.event_type_id !== filterType) return false;
    if (filterStatus === "confirmed" && !event.is_confirmed) return false;
    if (filterStatus === "unconfirmed" && event.is_confirmed) return false;
    return true;
  });

  const inputClass =
    "w-full px-4 py-3 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm"
          >
            <option value="all">All types</option>
            {eventTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(
                e.target.value as "all" | "confirmed" | "unconfirmed"
              )
            }
            className="px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm"
          >
            <option value="all">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="unconfirmed">Unconfirmed</option>
          </select>
        </div>
        <button
          onClick={startCreate}
          className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors"
        >
          Add Event
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-heading text-xl font-bold text-marine mb-6">
            {editing ? "Edit Event" : "New Event"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                className={inputClass}
                placeholder="Event title"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Event Type
              </label>
              <select
                value={formData.event_type_id}
                onChange={(e) =>
                  setFormData({ ...formData, event_type_id: e.target.value })
                }
                className={inputClass}
              >
                <option value="">Select type...</option>
                {eventTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Season
              </label>
              <select
                value={formData.season_id}
                onChange={(e) =>
                  setFormData({ ...formData, season_id: e.target.value })
                }
                className={inputClass}
              >
                <option value="">Select season...</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.year}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Start Date *
              </label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) =>
                  setFormData({ ...formData, start_date: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                End Date
              </label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) =>
                  setFormData({ ...formData, end_date: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={formData.start_time}
                onChange={(e) =>
                  setFormData({ ...formData, start_time: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Location
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                className={inputClass}
                placeholder="Event location"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className={inputClass}
                rows={3}
                placeholder="Event description"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                className={inputClass}
                rows={2}
                placeholder="Internal notes"
              />
            </div>
            <div className="md:col-span-2 flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm font-body text-marine">
                <input
                  type="checkbox"
                  checked={formData.is_confirmed}
                  onChange={(e) =>
                    setFormData({ ...formData, is_confirmed: e.target.checked })
                  }
                />
                Confirmed
              </label>
              <label className="flex items-center gap-2 text-sm font-body text-marine">
                <input
                  type="checkbox"
                  checked={formData.is_published}
                  onChange={(e) =>
                    setFormData({ ...formData, is_published: e.target.checked })
                  }
                />
                Published
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={handleSubmit}
              disabled={saving || !formData.title || !formData.start_date}
              className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Save Changes" : "Create Event"}
            </button>
            <button
              onClick={cancelForm}
              className="px-4 py-2 text-sm font-body text-muted-foreground hover:text-marine"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Events List */}
      <div className="space-y-3">
        {filteredEvents.length === 0 && (
          <div className="bg-white rounded-xl border border-border p-6 text-center text-muted-foreground font-body text-sm">
            No events found.
          </div>
        )}
        {filteredEvents.map((event) => {
          const eventType = getEventType(event.event_type_id);
          const season = getSeason(event.season_id);

          return (
            <div
              key={event.id}
              className="bg-white rounded-xl border border-border p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-body font-semibold text-marine text-lg">
                      {event.title}
                    </h3>
                    {eventType && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-body text-marine">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: eventType.color }}
                        />
                        {eventType.name}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-body ${
                        event.is_confirmed
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          event.is_confirmed ? "bg-green-500" : "bg-amber-500"
                        }`}
                      />
                      {event.is_confirmed ? "Confirmed" : "TBC"}
                    </span>
                    {event.is_published ? (
                      <span className="text-xs font-body text-sky-dark">
                        Published
                      </span>
                    ) : (
                      <span className="text-xs font-body text-muted-foreground">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground font-body flex-wrap">
                    <span>
                      {formatDate(event.start_date)}
                      {event.end_date && ` - ${formatDate(event.end_date)}`}
                    </span>
                    {event.start_time && <span>{event.start_time}</span>}
                    {event.location && <span>{event.location}</span>}
                    {season && (
                      <span className="text-xs">{season.year} season</span>
                    )}
                  </div>
                  {event.description && (
                    <p className="mt-2 text-sm text-muted-foreground font-body line-clamp-2">
                      {event.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(event)}
                    className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body hover:bg-cream transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(event.id)}
                    className="px-4 py-2 bg-white border border-border text-red-600 rounded-lg text-sm font-body hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
