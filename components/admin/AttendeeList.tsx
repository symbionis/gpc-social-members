"use client";

import { useState, useTransition } from "react";
import { formatDateTime, formatCurrency } from "@/lib/format";

interface Attendee {
  id: string;
  name: string;
  email: string;
  is_member: boolean;
  quantity: number;
  total_amount_chf: number;
  status: string;
  reference_code: string;
  created_at: string;
  checked_in_at: string | null;
}

interface Props {
  eventId: string;
  attendees: Attendee[];
}

function amountLabel(status: string, total: number) {
  if (status === "free" || total === 0) return "Free";
  return formatCurrency(total, { decimals: 2 });
}

export default function AttendeeList({ eventId, attendees }: Props) {
  const [rows, setRows] = useState(attendees);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggleCheckin(registrationId: string, current: boolean) {
    const next = !current;
    setError(null);
    setRows((prev) =>
      prev.map((r) =>
        r.id === registrationId
          ? { ...r, checked_in_at: next ? new Date().toISOString() : null }
          : r
      )
    );

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/events/${eventId}/attendees?registration_id=${registrationId}&checked_in=${next}`,
          { method: "PATCH" }
        );
        if (!res.ok) {
          setError("Could not update check-in. Refresh and try again.");
          // revert
          setRows((prev) =>
            prev.map((r) =>
              r.id === registrationId
                ? { ...r, checked_in_at: current ? new Date().toISOString() : null }
                : r
            )
          );
        }
      } catch (err) {
        console.error(err);
        setError("Network error. Could not update check-in.");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 text-center text-muted-foreground font-body text-sm">
        No registrations yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      {error && (
        <p className="px-4 py-2 text-sm font-body text-red-700 bg-red-50 border-b border-red-100">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead className="bg-cream/60 text-marine">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Name</th>
              <th className="text-left px-4 py-3 font-semibold">Email</th>
              <th className="text-left px-4 py-3 font-semibold">Member</th>
              <th className="text-left px-4 py-3 font-semibold">Tickets</th>
              <th className="text-left px-4 py-3 font-semibold">Amount</th>
              <th className="text-left px-4 py-3 font-semibold">Reference</th>
              <th className="text-left px-4 py-3 font-semibold">Registered</th>
              <th className="text-left px-4 py-3 font-semibold">Checked in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCheckedIn = Boolean(row.checked_in_at);
              return (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3 text-marine">{row.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.email}</td>
                  <td className="px-4 py-3">
                    {row.is_member ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">
                        Yes
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                        No
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-marine">{row.quantity}</td>
                  <td className="px-4 py-3 text-marine">
                    {amountLabel(row.status, Number(row.total_amount_chf))}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {row.reference_code}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDateTime(row.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isCheckedIn}
                        onChange={() => toggleCheckin(row.id, isCheckedIn)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {isCheckedIn ? "In" : "—"}
                      </span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
