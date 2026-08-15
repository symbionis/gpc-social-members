"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InviteTicketType } from "@/components/admin/EventInviteLink";

// Admin Guest list tab, rewritten onto the U5 model
// (docs/plans/2026-08-15-001-feat-unified-purchase-module-plan.md).
//
// A guest list is a list attached to an event: a list name, a list contact, and guests
// who each hold a registration-less ticket (KD10) — there is no entries table, a guest on
// a list IS a ticket. Adding a guest never charges anything, never touches a registration,
// and never affects the seat count (R12/R13/KTD4).
//
// This component deliberately declares its OWN local types rather than importing from
// lib/events/guest-lists.ts: that module reaches for lib/events/guest-list-auth.ts, which
// pulls in @/lib/supabase/server → next/headers, and this is a "use client" component. See
// lib/events/guest-lists.ts's header for the same rule stated from the server side.
//
// No paste import, no parser (KD11) — a guest is added one at a time: name, ticket type,
// optional email.

/** One guest on an existing list (a registration-less ticket). */
export interface GuestListPerson {
  ticketId: string;
  name: string;
  email: string | null;
  ticketTypeId: string | null;
  ticketTypeTitle: string;
  checkedIn: boolean;
}

/** One guest list: its own name, its contact, and its guests. */
export interface GuestListEntry {
  id: string;
  listName: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  people: GuestListPerson[];
}

interface Props {
  eventId: string;
  ticketTypes: InviteTicketType[];
  guestLists: GuestListEntry[];
}

/** The add-a-guest row under an existing list. */
interface AddState {
  name: string;
  email: string;
  ticketTypeId: string;
  submitting: boolean;
  error: string | null;
}

const EMPTY_ADD: AddState = { name: "", email: "", ticketTypeId: "", submitting: false, error: null };

const inputClass =
  "px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

export default function GuestList({ eventId, ticketTypes, guestLists }: Props) {
  const router = useRouter();

  // --- create-a-list form ---------------------------------------------------------
  const [listName, setListName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- per-list state ------------------------------------------------------------
  const [adds, setAdds] = useState<Record<string, AddState>>({});
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [listError, setListError] = useState<string | null>(null);

  function addState(listId: string): AddState {
    return adds[listId] ?? EMPTY_ADD;
  }
  function patchAdd(listId: string, patch: Partial<AddState>) {
    setAdds((s) => ({ ...s, [listId]: { ...(s[listId] ?? EMPTY_ADD), ...patch } }));
  }

  /** A ticket type resolves only if it is an ACTIVE type of this event (the route agrees). */
  function resolves(ticketTypeId: string) {
    return ticketTypes.some((t) => t.id === ticketTypeId);
  }

  async function createList() {
    if (creating) return;
    setCreateError(null);
    setNotice(null);

    if (!listName.trim()) {
      setCreateError("The list needs a name.");
      return;
    }
    if (!contactName.trim()) {
      setCreateError("The list needs a contact name.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/guest-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "list",
          listName: listName.trim(),
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim() || null,
          contactPhone: contactPhone.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(data.error || "Could not create the guest list.");
        return;
      }
      setNotice(`Guest list “${listName.trim()}” created.`);
      setListName("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      router.refresh();
    } catch {
      setCreateError("Network error. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function addGuest(listId: string) {
    const state = addState(listId);
    if (state.submitting) return;

    if (!state.name.trim()) {
      patchAdd(listId, { error: "The guest needs a name." });
      return;
    }
    if (!resolves(state.ticketTypeId)) {
      patchAdd(listId, { error: "Choose a ticket type for this guest." });
      return;
    }

    patchAdd(listId, { submitting: true, error: null });
    setListError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/guest-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "guest",
          listId,
          name: state.name.trim(),
          email: state.email.trim() || null,
          ticketTypeId: state.ticketTypeId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchAdd(listId, { submitting: false, error: data.error || "Could not add the guest." });
        return;
      }
      setAdds((s) => ({ ...s, [listId]: EMPTY_ADD }));
      router.refresh();
    } catch {
      patchAdd(listId, { submitting: false, error: "Network error. Try again." });
    }
  }

  async function deleteList(list: GuestListEntry) {
    if (!window.confirm(`Delete the guest list “${list.listName}”? This cannot be undone.`)) {
      return;
    }
    setListError(null);
    setDeleting((prev) => new Set(prev).add(list.id));
    try {
      const res = await fetch(`/api/admin/events/${eventId}/guest-lists`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: list.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(data.error || "Could not delete the guest list.");
        return;
      }
      router.refresh();
    } catch {
      setListError("Network error. Try again.");
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(list.id);
        return next;
      });
    }
  }

  function ticketTypeSelect(
    value: string,
    onChange: (id: string) => void,
    label: string,
    disabled = false
  ) {
    return (
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} min-w-[9rem]`}
      >
        <option value="">Ticket type…</option>
        {ticketTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4 max-w-3xl">
        <div>
          <h3 className="font-heading text-lg font-bold text-marine mb-1">New guest list</h3>
          <p className="font-body text-sm text-muted-foreground">
            A list attached to this event, with its own name and a contact person. Guests
            added below hold ordinary tickets — no registration, no payment, no manage
            link — and never count against the event&apos;s seat cap.
          </p>
        </div>

        {createError && (
          <p
            role="alert"
            className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
          >
            {createError}
          </p>
        )}
        {notice && (
          <p className="text-sm font-body text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <input
            aria-label="List name"
            placeholder="List name"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            className={inputClass}
          />
          <input
            aria-label="Contact name"
            placeholder="Contact name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className={inputClass}
          />
          <input
            aria-label="Contact email"
            type="email"
            placeholder="Contact email (optional)"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className={inputClass}
          />
          <input
            aria-label="Contact phone"
            placeholder="Contact phone (optional)"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className={inputClass}
          />
        </div>

        <button
          type="button"
          onClick={createList}
          disabled={creating}
          className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {creating ? "Creating…" : "Create guest list"}
        </button>
      </section>

      <section className="space-y-4">
        <h3 className="font-heading text-lg font-bold text-marine">
          Guest lists{guestLists.length > 0 ? ` (${guestLists.length})` : ""}
        </h3>

        {listError && (
          <p
            role="alert"
            className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 max-w-3xl"
          >
            {listError}
          </p>
        )}

        {guestLists.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">No guest lists yet.</p>
        ) : (
          guestLists.map((list) => {
            const add = addState(list.id);
            const isDeleting = deleting.has(list.id);
            const hasCheckedIn = list.people.some((p) => p.checkedIn);
            return (
              <section
                key={list.id}
                aria-label={`Guest list ${list.listName}`}
                className="rounded-lg border border-border bg-white overflow-hidden max-w-3xl"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-cream/40">
                  <div>
                    <p className="font-body font-semibold text-marine text-sm">{list.listName}</p>
                    <p className="font-body text-xs text-muted-foreground">
                      {list.contactName}
                      {list.contactEmail ? ` · ${list.contactEmail}` : ""}
                      {list.contactPhone ? ` · ${list.contactPhone}` : ""}
                      {" · "}
                      {list.people.length} guest{list.people.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteList(list)}
                    disabled={isDeleting}
                    title={
                      hasCheckedIn
                        ? "This list has a checked-in guest and cannot be deleted"
                        : undefined
                    }
                    className="px-3 py-1.5 border border-border text-red-700 rounded-lg text-xs font-body font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isDeleting ? "Deleting…" : "Delete list"}
                  </button>
                </div>

                {list.people.length > 0 && (
                  <ul className="divide-y divide-border/60">
                    {list.people.map((p) => (
                      <li
                        key={p.ticketId}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                      >
                        <div className="font-body text-sm text-marine">
                          {p.name}
                          {p.ticketTypeTitle && (
                            <span className="ml-2 text-xs text-sky-dark">{p.ticketTypeTitle}</span>
                          )}
                          {p.email && (
                            <span className="ml-2 text-xs text-muted-foreground">{p.email}</span>
                          )}
                          {p.checkedIn && (
                            <span className="ml-2 text-xs text-emerald-800">Checked in</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="px-4 py-3 border-t border-border/60 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Guest name"
                      placeholder="Add a guest"
                      value={add.name}
                      onChange={(e) => patchAdd(list.id, { name: e.target.value })}
                      className={inputClass}
                    />
                    <input
                      aria-label="Guest email"
                      type="email"
                      placeholder="Email (optional)"
                      value={add.email}
                      onChange={(e) => patchAdd(list.id, { email: e.target.value })}
                      className={inputClass}
                    />
                    {ticketTypeSelect(
                      add.ticketTypeId,
                      (id) => patchAdd(list.id, { ticketTypeId: id }),
                      "Guest ticket type"
                    )}
                    <button
                      type="button"
                      onClick={() => addGuest(list.id)}
                      disabled={add.submitting}
                      className="px-3 py-1.5 bg-marine text-white rounded-lg text-xs font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {add.submitting ? "Adding…" : "Add guest"}
                    </button>
                  </div>
                  <p className="font-body text-xs text-muted-foreground">
                    A guest attending several days is added once per day — one row per
                    admission.
                  </p>
                  {add.error && (
                    <p role="alert" className="font-body text-xs text-red-700">
                      {add.error}
                    </p>
                  )}
                </div>
              </section>
            );
          })
        )}
      </section>
    </div>
  );
}
