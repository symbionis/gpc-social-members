"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseGuestNames } from "@/lib/events/guest-list";
import type { InviteTicketType } from "@/components/admin/EventInviteLink";

// Admin Guest list tab (U3 of docs/plans/2026-07-11-001-feat-admin-guest-list-door-console-plan.md).
// Builds a sponsor's comp list as a real zero-price registration the door console already
// understands, and maintains the lists that exist.
//
// Nothing is emailed on create (R8) — "Resend tickets" on the lead is the delivery path
// for the party's QRs.
//
// The paste input is load-bearing: a sponsor sends a block of names, and the tab this
// replaces let an admin paste them. The block parses (lib/events/guest-list.ts) into
// EDITABLE rows — per-row name, email, ticket type — so a wrong row is corrected in place
// rather than silently dropped or retyped.

/** One credentialled person on an existing comp list (a ticket). */
export interface GuestListPerson {
  ticketId: string;
  name: string;
  email: string | null;
  ticketTypeTitle: string;
  isLead: boolean;
  checkedIn: boolean;
}

/** One sponsor's comp list: a registration with is_guest_list = true, plus its tickets. */
export interface GuestListEntry {
  registrationId: string;
  referenceCode: string | null;
  leadName: string;
  leadEmail: string;
  people: GuestListPerson[];
}

interface Props {
  eventId: string;
  ticketTypes: InviteTicketType[];
  guestLists: GuestListEntry[];
  hasSeatCap: boolean;
  seatCap: number | null;
  /** Tickets already held for this event — what the cap confirm counts from. */
  total: number;
}

/** An unsubmitted guest row in the create form. */
interface DraftRow {
  key: string;
  name: string;
  email: string;
  ticketTypeId: string;
}

/** The add-a-guest row under an existing list. */
interface AddState {
  name: string;
  email: string;
  ticketTypeId: string;
  /**
   * One idempotency key per submit, held across retries (KTD2). A submitting flag does
   * not survive a network retry or a back-and-resubmit; the key does, and the server
   * returns the prior result unchanged when it repeats.
   */
  idempotencyKey: string | null;
  submitting: boolean;
  error: string | null;
}

const EMPTY_ADD: AddState = {
  name: "",
  email: "",
  ticketTypeId: "",
  idempotencyKey: null,
  submitting: false,
  error: null,
};

let rowSeq = 0;
function newRow(ticketTypeId: string): DraftRow {
  rowSeq += 1;
  return { key: `row-${rowSeq}`, name: "", email: "", ticketTypeId };
}

const inputClass =
  "px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

export default function GuestList({
  eventId,
  ticketTypes,
  guestLists,
  hasSeatCap,
  seatCap,
  total,
}: Props) {
  const router = useRouter();

  // --- create form ---------------------------------------------------------------
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadTicketTypeId, setLeadTicketTypeId] = useState("");
  const [defaultTicketTypeId, setDefaultTicketTypeId] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteErrors, setPasteErrors] = useState<{ line: number; reason: string }[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- per-list state ------------------------------------------------------------
  const [adds, setAdds] = useState<Record<string, AddState>>({});
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [resending, setResending] = useState<Set<string>>(new Set());
  const [listError, setListError] = useState<string | null>(null);

  function addState(regId: string): AddState {
    return adds[regId] ?? EMPTY_ADD;
  }
  // Merges from the CURRENT state, not the render closure: the failure branch of addGuest
  // patches state the same handler already set (the idempotency key), and a closure merge
  // would drop it — turning the retry into a second, un-deduped submit.
  function patchAdd(regId: string, patch: Partial<AddState>) {
    setAdds((s) => ({ ...s, [regId]: { ...(s[regId] ?? EMPTY_ADD), ...patch } }));
  }

  /** A ticket type resolves only if it is an ACTIVE type of this event (the RPC agrees). */
  function resolves(ticketTypeId: string) {
    return ticketTypes.some((t) => t.id === ticketTypeId);
  }

  /**
   * The cap is not enforced server-side on the comp path (KTD6) — an admin may comp past
   * a full event. This confirm is a prompt, not a control.
   */
  function pastCapConfirmed(seats: number) {
    if (!hasSeatCap || seatCap === null || total + seats <= seatCap) return true;
    return window.confirm(
      `This will put the event at ${total + seats} / ${seatCap} tickets — add anyway?`
    );
  }

  function addPastedNames() {
    const { rows: parsed, errors } = parseGuestNames(pasteText);
    setPasteErrors(errors.map((e) => ({ line: e.line, reason: e.reason })));
    if (parsed.length === 0) return;
    setRows((current) => [
      ...current,
      ...parsed.map((p) => ({ ...newRow(defaultTicketTypeId), name: p.name })),
    ]);
    setPasteText("");
  }

  function patchRow(key: string, patch: Partial<DraftRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const unresolvedRows = rows.filter((r) => !resolves(r.ticketTypeId)).length;

  async function createList() {
    if (creating) return;
    setCreateError(null);
    setNotice(null);

    if (!leadName.trim() || !leadEmail.trim()) {
      setCreateError("The lead needs a name and an email.");
      return;
    }
    if (!resolves(leadTicketTypeId)) {
      setCreateError("Choose a ticket type for the lead.");
      return;
    }
    if (rows.some((r) => !r.name.trim())) {
      setCreateError("Every guest row needs a name.");
      return;
    }
    if (unresolvedRows > 0) {
      setCreateError(
        `${unresolvedRows} guest row${unresolvedRows === 1 ? "" : "s"} still need a ticket type.`
      );
      return;
    }
    if (!pastCapConfirmed(1 + rows.length)) return;

    setCreating(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/guest-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: {
            name: leadName.trim(),
            email: leadEmail.trim(),
            ticketTypeId: leadTicketTypeId,
          },
          guests: rows.map((r) => ({
            name: r.name.trim(),
            email: r.email.trim() || null,
            ticketTypeId: r.ticketTypeId,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(data.error || "Could not create the guest list.");
        return;
      }
      setNotice(
        `Guest list created${data.reference_code ? ` (ref ${data.reference_code})` : ""} — send the QRs with “Resend tickets”.`
      );
      setLeadName("");
      setLeadEmail("");
      setPasteText("");
      setPasteErrors([]);
      setRows([]);
      router.refresh();
    } catch {
      setCreateError("Network error. Try again.");
    } finally {
      setCreating(false);
    }
  }

  async function addGuest(regId: string) {
    const state = addState(regId);
    if (state.submitting) return;

    if (!state.name.trim()) {
      patchAdd(regId, { error: "The guest needs a name." });
      return;
    }
    if (!resolves(state.ticketTypeId)) {
      patchAdd(regId, { error: "Choose a ticket type for this guest." });
      return;
    }
    if (!pastCapConfirmed(1)) return;

    // Reuse the key of a submit that already went out (a retry must not add twice).
    const idempotencyKey = state.idempotencyKey ?? crypto.randomUUID();
    patchAdd(regId, { submitting: true, error: null, idempotencyKey });
    setListError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/guest-list/${regId}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          guests: [
            {
              name: state.name.trim(),
              email: state.email.trim() || null,
              ticketTypeId: state.ticketTypeId,
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Key kept: the next click is a retry of THIS submit, not a new one.
        patchAdd(regId, { submitting: false, error: data.error || "Could not add the guest." });
        return;
      }
      setAdds((s) => ({ ...s, [regId]: EMPTY_ADD }));
      router.refresh();
    } catch {
      patchAdd(regId, { submitting: false, error: "Network error. Try again." });
    }
  }

  async function removeGuest(regId: string, person: GuestListPerson, listLead: string) {
    if (
      !window.confirm(
        `Remove ${person.name || "this guest"} from ${listLead || "this"}'s guest list?`
      )
    ) {
      return;
    }
    setListError(null);
    setRemoving((prev) => new Set(prev).add(person.ticketId));
    try {
      const res = await fetch(`/api/admin/events/${eventId}/guest-list/${regId}/guests`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: person.ticketId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(data.error || "Could not remove the guest.");
        return;
      }
      router.refresh();
    } catch {
      setListError("Network error. Try again.");
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(person.ticketId);
        return next;
      });
    }
  }

  // Nothing is emailed when a comp list is created (R8), so this is how the party's QRs
  // reach the lead. Same action as the roster tab's resend.
  async function resendTickets(regId: string, name: string) {
    setListError(null);
    setNotice(null);
    setResending((prev) => new Set(prev).add(regId));
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/registrations/${regId}/resend-confirmation`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(data.error || "Could not resend the tickets.");
        return;
      }
      setNotice(`Tickets resent to ${name || data.email || "the lead"}.`);
      router.refresh();
    } catch {
      setListError("Could not resend the tickets.");
    } finally {
      setResending((prev) => {
        const next = new Set(prev);
        next.delete(regId);
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
          <h3 className="font-heading text-lg font-bold text-marine mb-1">
            New guest list
          </h3>
          <p className="font-body text-sm text-muted-foreground">
            A sponsor&apos;s comp party: the lead plus their guests, each with their own
            free ticket and QR. Guests are name-only — an email is optional. Nothing is
            emailed here; send the QRs with <strong>Resend tickets</strong> once the list
            looks right.
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
            aria-label="Lead name"
            placeholder="Lead name"
            value={leadName}
            onChange={(e) => setLeadName(e.target.value)}
            className={inputClass}
          />
          <input
            aria-label="Lead email"
            type="email"
            placeholder="Lead email"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
            className={inputClass}
          />
          {ticketTypeSelect(leadTicketTypeId, setLeadTicketTypeId, "Lead ticket type")}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-body text-sm text-muted-foreground">
              Paste the sponsor&apos;s list — one name per line:
            </span>
            {ticketTypeSelect(
              defaultTicketTypeId,
              setDefaultTicketTypeId,
              "Default ticket type"
            )}
          </div>
          <textarea
            aria-label="Paste guest names"
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"Bruno Keller\nChiara Bosco\nDavid Nunez"}
            className={`${inputClass} w-full font-mono`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addPastedNames}
              disabled={pasteText.trim() === ""}
              className="px-3 py-1.5 bg-marine text-white rounded-lg text-xs font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Add pasted names
            </button>
            <button
              type="button"
              onClick={() => setRows((current) => [...current, newRow(defaultTicketTypeId)])}
              className="px-3 py-1.5 border border-border text-marine rounded-lg text-xs font-body font-medium hover:bg-cream/60 transition-colors cursor-pointer"
            >
              Add row
            </button>
          </div>
          {pasteErrors.length > 0 && (
            <ul className="font-body text-xs text-red-700 space-y-0.5">
              {pasteErrors.map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r, i) => {
              const unresolved = !resolves(r.ticketTypeId);
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Guest ${i + 1} name`}
                    placeholder="Name"
                    value={r.name}
                    onChange={(e) => patchRow(r.key, { name: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`Guest ${i + 1} email`}
                    type="email"
                    placeholder="Email (optional)"
                    value={r.email}
                    onChange={(e) => patchRow(r.key, { email: e.target.value })}
                    className={inputClass}
                  />
                  {ticketTypeSelect(
                    r.ticketTypeId,
                    (id) => patchRow(r.key, { ticketTypeId: id }),
                    `Guest ${i + 1} ticket type`
                  )}
                  <button
                    type="button"
                    aria-label={`Remove guest ${i + 1}`}
                    onClick={() =>
                      setRows((current) => current.filter((row) => row.key !== r.key))
                    }
                    className="px-2 py-1 text-xs font-body text-red-700 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                  {unresolved && (
                    <span className="font-body text-xs text-red-700">Choose a ticket type</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

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
            const add = addState(list.registrationId);
            const isResending = resending.has(list.registrationId);
            return (
              <section
                key={list.registrationId}
                aria-label={`Guest list for ${list.leadName}`}
                className="rounded-lg border border-border bg-white overflow-hidden max-w-3xl"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-cream/40">
                  <div>
                    <p className="font-body font-semibold text-marine text-sm">
                      {list.leadName}
                      {list.referenceCode && (
                        <span className="font-mono text-xs text-muted-foreground ml-2">
                          {list.referenceCode}
                        </span>
                      )}
                    </p>
                    <p className="font-body text-xs text-muted-foreground">
                      {list.leadEmail} · {list.people.length} ticket
                      {list.people.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resendTickets(list.registrationId, list.leadName)}
                    disabled={isResending}
                    className="px-3 py-1.5 border border-border text-marine rounded-lg text-xs font-body font-medium hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isResending ? "Sending…" : "Resend tickets"}
                  </button>
                </div>

                <ul className="divide-y divide-border/60">
                  {list.people.map((p) => (
                    <li
                      key={p.ticketId}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                    >
                      <div className="font-body text-sm text-marine">
                        {p.name}
                        {p.isLead && (
                          <span className="ml-2 text-xs text-muted-foreground">Lead</span>
                        )}
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
                      {/* The lead is the registration; a checked-in guest is already
                          through the door (R7). Neither can be removed. */}
                      {!p.isLead && !p.checkedIn && (
                        <button
                          type="button"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => removeGuest(list.registrationId, p, list.leadName)}
                          disabled={removing.has(p.ticketId)}
                          className="px-2 py-1 text-xs font-body text-red-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {removing.has(p.ticketId) ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="px-4 py-3 border-t border-border/60 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Guest name"
                      placeholder="Add a guest"
                      value={add.name}
                      onChange={(e) => patchAdd(list.registrationId, { name: e.target.value })}
                      className={inputClass}
                    />
                    <input
                      aria-label="Guest email"
                      type="email"
                      placeholder="Email (optional)"
                      value={add.email}
                      onChange={(e) => patchAdd(list.registrationId, { email: e.target.value })}
                      className={inputClass}
                    />
                    {ticketTypeSelect(
                      add.ticketTypeId,
                      (id) => patchAdd(list.registrationId, { ticketTypeId: id }),
                      "Guest ticket type"
                    )}
                    <button
                      type="button"
                      onClick={() => addGuest(list.registrationId)}
                      disabled={add.submitting}
                      className="px-3 py-1.5 bg-marine text-white rounded-lg text-xs font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {add.submitting ? "Adding…" : "Add guest"}
                    </button>
                  </div>
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
