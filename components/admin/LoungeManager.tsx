"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LoungeSession {
  id: string;
  day_of_week: string;
  time_slot: string;
  is_open: boolean;
  field_number: number;
  updated_by: string | null;
  updated_at: string | null;
}

interface LoungeManagerProps {
  sessions: LoungeSession[];
  adminMap: Record<string, string>;
}

const dayLabels: Record<string, string> = {
  wednesday: "Wednesday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const timeLabels: Record<string, string> = {
  am: "Morning",
  pm: "Afternoon",
};

export default function LoungeManager({ sessions, adminMap }: LoungeManagerProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function handleUpdate(
    sessionId: string,
    updates: { is_open?: boolean; field_number?: number },
    current: LoungeSession
  ) {
    setLoadingId(sessionId);
    try {
      const body = {
        session_id: sessionId,
        is_open: updates.is_open ?? current.is_open,
        field_number: updates.field_number ?? current.field_number,
      };

      await fetch("/api/admin/lounge/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      router.refresh();
    } finally {
      setLoadingId(null);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-CH", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {sessions.map((session) => {
        const isLoading = loadingId === session.id;
        const dayLabel = dayLabels[session.day_of_week] || session.day_of_week;
        const timeLabel = timeLabels[session.time_slot] || session.time_slot;
        const updatedByName = session.updated_by
          ? adminMap[session.updated_by] || "Unknown"
          : null;

        return (
          <div
            key={session.id}
            className="bg-white rounded-xl border border-border p-6"
          >
            <h2 className="font-heading text-lg font-semibold text-marine mb-4">
              {dayLabel} &mdash; {timeLabel}
            </h2>

            {/* Status toggle */}
            <div className="mb-4">
              <button
                disabled={isLoading}
                onClick={() =>
                  handleUpdate(session.id, { is_open: !session.is_open }, session)
                }
                className={`font-body text-sm font-medium px-4 py-2 rounded-full transition-colors ${
                  session.is_open
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-600"
                } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                {isLoading ? "Saving..." : session.is_open ? "Open" : "Closed"}
              </button>
            </div>

            {/* Field selector */}
            <div className="flex gap-2 mb-4">
              {[1, 2].map((num) => (
                <button
                  key={num}
                  disabled={isLoading}
                  onClick={() =>
                    handleUpdate(session.id, { field_number: num }, session)
                  }
                  className={`font-body text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                    session.field_number === num
                      ? "bg-marine text-white"
                      : "bg-white border border-border text-marine"
                  } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  Field {num}
                </button>
              ))}
            </div>

            {/* Last updated */}
            {updatedByName && session.updated_at && (
              <p className="font-body text-xs text-muted-foreground">
                Last updated by {updatedByName} at {formatDate(session.updated_at)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
