"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RowReport {
  line: number;
  raw: string;
  status: "inserted" | "merged" | "error";
  reason?: string;
}

interface ImportResult {
  counts: { inserted: number; merged: number; errors: number };
  rows: RowReport[];
}

const EXAMPLE = `Jane Doe, CH, 078 123 45 67, jane@example.com
Marco Rossi, IT, 06 1234 5678
Email Only, , , solo@example.com`;

// Admin bulk-import roster (U3). Paste rows (name, country, phone, email?) — one per
// line — and POST to the import route, which dedupes against existing attendees and
// returns a per-row report.
export default function RosterImport({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit() {
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/attendees/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Import failed. Try again.");
        return;
      }
      setResult(data as ImportResult);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const errorRows = result?.rows.filter((r) => r.status === "error") ?? [];

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="font-heading text-lg font-bold text-marine mb-1">
          Bulk-import roster
        </h3>
        <p className="font-body text-sm text-muted-foreground mb-2">
          Paste one attendee per line: <span className="font-mono">name, country, phone, email</span>.
          Country is a 2-letter code (CH, FR, IT…). Email is optional when a phone is
          given; phone is optional when an email is given. Existing attendees matched by
          phone or email are enriched, not duplicated.
        </p>
        <pre className="font-mono text-xs text-muted-foreground bg-cream/40 border border-border rounded-lg px-3 py-2 whitespace-pre-wrap">
          {EXAMPLE}
        </pre>
      </div>

      {error && (
        <p className="text-sm font-body text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={EXAMPLE}
        className="w-full px-3 py-2 rounded-lg border border-border bg-white text-marine font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky/50 focus:border-sky"
      />

      <button
        type="button"
        onClick={submit}
        disabled={submitting || text.trim() === ""}
        className="px-4 py-2 bg-marine text-white rounded-lg text-sm font-body font-medium hover:bg-marine-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {submitting ? "Importing…" : "Import roster"}
      </button>

      {result && (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap font-body text-sm">
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
              {result.counts.inserted} inserted
            </span>
            <span className="px-3 py-1 rounded-full bg-sky/10 text-sky-dark">
              {result.counts.merged} merged
            </span>
            <span
              className={`px-3 py-1 rounded-full ${
                result.counts.errors > 0
                  ? "bg-red-100 text-red-800"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {result.counts.errors} error{result.counts.errors === 1 ? "" : "s"}
            </span>
          </div>

          {errorRows.length > 0 && (
            <div className="rounded-lg border border-border bg-white overflow-hidden">
              <div className="px-4 py-2 bg-cream/40 font-body font-semibold text-marine text-sm">
                Rows not imported
              </div>
              <ul className="divide-y divide-border/60">
                {errorRows.map((r) => (
                  <li key={r.line} className="px-4 py-2 font-body text-sm">
                    <span className="text-muted-foreground">Line {r.line}:</span>{" "}
                    <span className="text-red-700">{r.reason}</span>
                    {r.raw && (
                      <div className="font-mono text-xs text-muted-foreground mt-0.5 truncate">
                        {r.raw}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
