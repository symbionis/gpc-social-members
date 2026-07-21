"use client";

// Controlled editor for an event's ticket types. Pure UI: it owns no
// persistence. EventManager collects the rows and either seeds them atomically
// on create (via the create_event_with_ticket_types RPC) or diff-syncs them to
// the single-writer ticket-types API on edit. The guest/invite price is NOT
// edited here — it is set later per type in Manage Event → Settings (U8).

export interface TicketTypeDraft {
  id?: string; // server id when this row already exists (edit mode)
  title: string;
  price_member: string; // form strings; "" = unset
  price_non_member: string;
  // Guest (invite) price is NOT edited here — it's owned by Manage Event →
  // Settings. It rides along as a carry-through so saving an edit preserves it
  // instead of nulling it on the per-type PATCH.
  invite_price: string;
  counts_as_seat: boolean;
  // Optional buyer-facing blurb shown beside the type at registration. "" = unset.
  description: string;
}

// Mirror of the server cap in lib/events/ticket-types.ts (TICKET_TYPE_DESCRIPTION_MAX)
// and the DB CHECK. Kept as a literal so this client component doesn't import the
// server-only ticket-types module. Keep the three numerically identical.
const DESCRIPTION_MAX = 500;

export function makeStandardDraft(): TicketTypeDraft {
  return { title: "Standard", price_member: "", price_non_member: "", invite_price: "", counts_as_seat: true, description: "" };
}

interface Props {
  value: TicketTypeDraft[];
  onChange: (next: TicketTypeDraft[]) => void;
  visibility: "members_only" | "public";
  registrationEnabled: boolean;
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-border bg-white text-marine font-body text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky";

export default function TicketTypesEditor({
  value,
  onChange,
  visibility,
  registrationEnabled,
}: Props) {
  const isPublic = visibility === "public";

  function update(i: number, patch: Partial<TicketTypeDraft>) {
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function add() {
    onChange([...value, { title: "", price_member: "", price_non_member: "", invite_price: "", counts_as_seat: true, description: "" }]);
  }
  function remove(i: number) {
    if (value.length <= 1) return; // keep >=1
    onChange(value.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const target = i + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  }

  return (
    <div className="md:col-span-2">
      <label className="block text-xs font-body text-muted-foreground mb-1">
        Ticket types
      </label>
      <p className="text-xs text-muted-foreground mb-3">
        Each type has its own prices. Member price is required once registration
        is enabled{isPublic ? "; non-member price is required for public events" : ""} (use 0
        for free). Guest prices for the invite link are set later in Manage Event → Settings.
      </p>

      <div className="space-y-2">
        {value.map((row, i) => (
          <div
            key={row.id ?? `new-${i}`}
            className="flex items-start gap-2 rounded-lg border border-border p-3 bg-cream/30"
          >
            <div className="flex flex-col gap-1 pt-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move ticket type up"
                className="px-1.5 text-xs text-marine border border-border rounded hover:bg-cream disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
                aria-label="Move ticket type down"
                className="px-1.5 text-xs text-marine border border-border rounded hover:bg-cream disabled:opacity-30"
              >
                ↓
              </button>
            </div>

            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={row.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  className={inputClass}
                  placeholder="Ticket type name (e.g. Standard, Kids)"
                  aria-label="Ticket type name"
                />
              </div>
              <div className="sm:col-span-2">
                <textarea
                  value={row.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  className={`${inputClass} resize-y min-h-[2.5rem]`}
                  rows={2}
                  placeholder="Description (optional) — what's included, shown to buyers"
                  aria-label="Ticket type description"
                />
                <p
                  className={`mt-1 text-right text-xs ${
                    row.description.length > DESCRIPTION_MAX ? "text-red-600" : "text-muted-foreground"
                  }`}
                >
                  {row.description.length}/{DESCRIPTION_MAX}
                </p>
              </div>
              <div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.price_member}
                  onChange={(e) => update(i, { price_member: e.target.value })}
                  disabled={!registrationEnabled}
                  className={inputClass}
                  placeholder="Member price (CHF)"
                  aria-label="Member price"
                />
              </div>
              {isPublic && (
                <div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.price_non_member}
                    onChange={(e) => update(i, { price_non_member: e.target.value })}
                    disabled={!registrationEnabled}
                    className={inputClass}
                    placeholder="Non-member price (CHF)"
                    aria-label="Non-member price"
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-xs font-body text-marine sm:col-span-2">
                <input
                  type="checkbox"
                  checked={row.counts_as_seat}
                  onChange={(e) => update(i, { counts_as_seat: e.target.checked })}
                />
                Counts toward capacity
              </label>
            </div>

            <button
              type="button"
              onClick={() => remove(i)}
              disabled={value.length <= 1}
              aria-label="Remove ticket type"
              title={value.length <= 1 ? "An event must keep at least one ticket type" : "Remove"}
              className="px-2 py-1 text-red-600 border border-border rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-2 px-3 py-1.5 text-sm font-body text-marine border border-border rounded-lg hover:bg-cream"
      >
        + Add ticket type
      </button>
    </div>
  );
}
