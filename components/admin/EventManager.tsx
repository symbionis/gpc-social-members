"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import posthog from "posthog-js";

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
  image_url: string | null;
  image_url_2: string | null;
  images?: unknown;
  visibility?: string | null;
  registration_enabled?: boolean | null;
  price_member?: number | null;
  price_non_member?: number | null;
}

function coerceImages(value: unknown, fallbacks: (string | null | undefined)[]): string[] {
  if (Array.isArray(value)) {
    const cleaned = value.filter((u): u is string => typeof u === "string" && u.length > 0);
    if (cleaned.length > 0) return cleaned;
  }
  return fallbacks.filter((u): u is string => typeof u === "string" && u.length > 0);
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
  images: [] as string[],
  visibility: "members_only" as "members_only" | "public",
  registration_enabled: false,
  price_member: "",
  price_non_member: "",
};

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleImageUpload(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      alert("Please upload a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      alert("Image must be under 5 MB.");
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("event-images")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      alert("Image upload failed. Please try again.");
      setUploading(false);
      return;
    }

    const { data } = supabase.storage
      .from("event-images")
      .getPublicUrl(path);

    setFormData((prev) => ({ ...prev, images: [...prev.images, data.publicUrl] }));
    setUploading(false);
  }

  function removeImage(index: number) {
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  }

  function moveImage(index: number, dir: -1 | 1) {
    setFormData((prev) => {
      const next = [...prev.images];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, images: next };
    });
  }

  function makeHero(index: number) {
    setFormData((prev) => {
      if (index === 0 || index >= prev.images.length) return prev;
      const next = [...prev.images];
      const [picked] = next.splice(index, 1);
      next.unshift(picked);
      return { ...prev, images: next };
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
      images: coerceImages(event.images, [event.image_url, event.image_url_2]),
      visibility: event.visibility === "public" ? "public" : "members_only",
      registration_enabled: Boolean(event.registration_enabled),
      price_member:
        event.price_member === null || event.price_member === undefined
          ? ""
          : String(event.price_member),
      price_non_member:
        event.price_non_member === null || event.price_non_member === undefined
          ? ""
          : String(event.price_non_member),
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

    if (formData.registration_enabled) {
      const isMembersOnly = formData.visibility === "members_only";
      if (formData.price_member === "") {
        alert("Member price is required when registration is enabled.");
        return;
      }
      if (!isMembersOnly && formData.price_non_member === "") {
        alert("Non-member price is required for public events when registration is enabled.");
        return;
      }
      const pm = Number(formData.price_member);
      if (!Number.isFinite(pm) || pm < 0) {
        alert("Member price must be a valid non-negative number.");
        return;
      }
      if (!isMembersOnly && formData.price_non_member !== "") {
        const pn = Number(formData.price_non_member);
        if (!Number.isFinite(pn) || pn < 0) {
          alert("Non-member price must be a valid non-negative number.");
          return;
        }
      }
    }

    setSaving(true);
    const action = editing ? "update" : "create";
    const endpoint = editing
      ? "/api/admin/events/update"
      : "/api/admin/events/create";

    const body = editing
      ? { event_id: editing, ...formData }
      : { ...formData };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({} as { error?: string }));
        const message =
          (errJson as { error?: string }).error ||
          `Save failed (HTTP ${res.status})`;
        try {
          posthog.capture("event_save_failed", {
            action,
            event_id: editing || null,
            status: res.status,
            error: message,
            visibility: formData.visibility,
            registration_enabled: formData.registration_enabled,
          });
        } catch {
          /* posthog not initialized — ignore */
        }
        alert(`Could not save event: ${message}`);
        setSaving(false);
        return;
      }

      try {
        posthog.capture("event_save_succeeded", {
          action,
          event_id: editing || null,
          visibility: formData.visibility,
          registration_enabled: formData.registration_enabled,
        });
      } catch {
        /* posthog not initialized — ignore */
      }
    } catch (e) {
      try {
        posthog.capture("event_save_failed", {
          action,
          event_id: editing || null,
          status: 0,
          error: e instanceof Error ? e.message : "network_error",
          visibility: formData.visibility,
          registration_enabled: formData.registration_enabled,
        });
      } catch {
        /* posthog not initialized — ignore */
      }
      alert("Network error saving event. Please try again.");
      setSaving(false);
      return;
    }

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

      {/* Form — right-hand slide-over */}
      {showForm && (
        <>
          <div
            className="fixed inset-0 bg-marine/40 z-40"
            onClick={cancelForm}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Edit event" : "New event"}
            className="fixed top-0 right-0 h-full w-full sm:w-[640px] max-w-full bg-white shadow-xl z-50 flex flex-col"
          >
            <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="font-heading text-xl font-bold text-marine">
                {editing ? "Edit Event" : "New Event"}
              </h2>
              <button
                onClick={cancelForm}
                aria-label="Close"
                className="text-muted-foreground hover:text-marine text-2xl leading-none px-2"
              >
                ×
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-6">
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
            {/* Image uploads */}
            <div className="md:col-span-2">
              <label className="block text-xs font-body text-muted-foreground mb-2">
                Event Images
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                The first image is the hero (used as the page banner and list
                thumbnail). All images are shown in the carousel on the event
                page.
              </p>
              <div className="flex gap-3 flex-wrap">
                {formData.images.map((url, i) => (
                  <div key={`${url}-${i}`} className="w-44">
                    <div className="relative group">
                      <img
                        src={url}
                        alt={`Event image ${i + 1}`}
                        className="w-44 h-28 object-cover rounded-lg border border-border"
                      />
                      {i === 0 && (
                        <span className="absolute top-1 left-1 px-2 py-0.5 rounded-full text-[10px] font-body font-medium bg-marine text-white">
                          Hero
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 w-6 h-6 bg-red-600 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove image"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1.5">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveImage(i, -1)}
                          disabled={i === 0}
                          className="px-2 py-1 text-xs font-body text-marine border border-border rounded hover:bg-cream disabled:opacity-40"
                          aria-label="Move left"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImage(i, 1)}
                          disabled={i === formData.images.length - 1}
                          className="px-2 py-1 text-xs font-body text-marine border border-border rounded hover:bg-cream disabled:opacity-40"
                          aria-label="Move right"
                        >
                          →
                        </button>
                      </div>
                      {i !== 0 && (
                        <button
                          type="button"
                          onClick={() => makeHero(i)}
                          className="px-2 py-1 text-xs font-body text-sky-dark hover:underline"
                        >
                          Set as hero
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-44 h-28 rounded-lg border-2 border-dashed border-border hover:border-sky transition-colors flex flex-col items-center justify-center text-muted-foreground text-sm font-body"
                >
                  {uploading ? (
                    "Uploading..."
                  ) : (
                    <>
                      <span className="text-2xl mb-1">+</span>
                      <span>Add image</span>
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                JPG, PNG, or WebP. Max 5 MB each.
              </p>
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

            {/* Visibility */}
            <div className="md:col-span-2">
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Visibility
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm font-body text-marine">
                  <input
                    type="radio"
                    name="visibility"
                    value="members_only"
                    checked={formData.visibility === "members_only"}
                    onChange={() =>
                      setFormData({ ...formData, visibility: "members_only", price_non_member: "" })
                    }
                  />
                  Members only
                </label>
                <label className="flex items-center gap-2 text-sm font-body text-marine">
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={formData.visibility === "public"}
                    onChange={() =>
                      setFormData({ ...formData, visibility: "public" })
                    }
                  />
                  Public
                </label>
              </div>
            </div>

            {/* Registration */}
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm font-body text-marine">
                <input
                  type="checkbox"
                  checked={formData.registration_enabled}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      registration_enabled: e.target.checked,
                    })
                  }
                />
                Registration enabled
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                When enabled, attendees can register and pay through the event
                page. Member price is required; non-member price is required only for public events (use 0 for free).
              </p>
            </div>

            <div>
              <label className="block text-xs font-body text-muted-foreground mb-1">
                Member price (CHF)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.price_member}
                onChange={(e) =>
                  setFormData({ ...formData, price_member: e.target.value })
                }
                disabled={!formData.registration_enabled}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            {formData.visibility !== "members_only" && (
              <div>
                <label className="block text-xs font-body text-muted-foreground mb-1">
                  Non-member price (CHF)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.price_non_member}
                  onChange={(e) =>
                    setFormData({ ...formData, price_non_member: e.target.value })
                  }
                  disabled={!formData.registration_enabled}
                  className={inputClass}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
            </div>
            <footer className="flex gap-2 px-6 py-4 border-t border-border shrink-0 bg-white">
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
            </footer>
          </aside>
        </>
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
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-body ${
                        event.visibility === "public"
                          ? "bg-sky/10 text-sky-dark"
                          : "bg-marine/5 text-marine"
                      }`}
                    >
                      {event.visibility === "public" ? "Public" : "Members only"}
                    </span>
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
                  {(() => {
                    const imgs = coerceImages(event.images, [event.image_url, event.image_url_2]);
                    return imgs.length > 0 ? (
                      <div className="flex gap-2 mt-3">
                        {imgs.slice(0, 4).map((url, i) => (
                          <img
                            key={`${url}-${i}`}
                            src={url}
                            alt=""
                            className="w-20 h-14 object-cover rounded border border-border"
                          />
                        ))}
                        {imgs.length > 4 && (
                          <div className="w-20 h-14 rounded border border-border bg-cream/60 flex items-center justify-center text-xs font-body text-muted-foreground">
                            +{imgs.length - 4}
                          </div>
                        )}
                      </div>
                    ) : null;
                  })()}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {event.registration_enabled && (
                    <a
                      href={`/admin/events/${event.id}/attendees`}
                      className="px-4 py-2 bg-white border border-border text-marine rounded-lg text-sm font-body hover:bg-cream transition-colors"
                    >
                      Attendees
                    </a>
                  )}
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
