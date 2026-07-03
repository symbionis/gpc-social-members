"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

interface Props {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

// Local YYYY-MM-DD for a Date (browser-local; a day-boundary drift vs Geneva is
// acceptable for a coarse date filter — the server re-buckets by Geneva time).
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

// The date filter drives every panel: it pushes `from`/`to` into the URL, which
// re-runs the server component's aggregation. State lives in the URL so a range
// is shareable and bookmarkable.
export default function DateRangeFilter({ from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  function apply(nextFrom: string, nextTo: string) {
    setLocalFrom(nextFrom);
    setLocalTo(nextTo);
    router.push(`${pathname}?from=${nextFrom}&to=${nextTo}`);
  }

  const thisYear = () => {
    const now = new Date();
    apply(`${now.getFullYear()}-01-01`, ymd(now));
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-xs font-body text-marine/60">
        From
        <input
          type="date"
          value={localFrom}
          onChange={(e) => setLocalFrom(e.target.value)}
          className="mt-1 rounded-lg border border-marine/20 px-3 py-2 text-sm text-marine"
        />
      </label>
      <label className="flex flex-col text-xs font-body text-marine/60">
        To
        <input
          type="date"
          value={localTo}
          onChange={(e) => setLocalTo(e.target.value)}
          className="mt-1 rounded-lg border border-marine/20 px-3 py-2 text-sm text-marine"
        />
      </label>
      <button
        onClick={() => apply(localFrom, localTo)}
        className="rounded-lg bg-marine text-white px-4 py-2 text-sm font-body hover:bg-marine/90"
      >
        Apply
      </button>

      <div className="flex gap-2 ml-auto">
        <Preset label="This year" onClick={thisYear} />
        <Preset label="Last 30 days" onClick={() => apply(daysAgo(30), ymd(new Date()))} />
        <Preset label="Last 90 days" onClick={() => apply(daysAgo(90), ymd(new Date()))} />
      </div>
    </div>
  );
}

function Preset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-marine/20 px-3 py-2 text-xs font-body text-marine/70 hover:bg-marine/5"
    >
      {label}
    </button>
  );
}
