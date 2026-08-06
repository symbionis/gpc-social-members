"use client";

// A full-width accordion header row: the whole row is the control, carrying the
// same hit area and hover treatment as the clickable rows in the shared finance
// `Table`, so disclosure lists across the admin feel alike. A native <button>
// gives Enter and Space for free.
//
// Shared by the finance dashboard's originator breakdown and the originators
// page's referred-member list — one definition so the two cannot drift apart.
export default function DisclosureRow({
  open,
  onToggle,
  label,
  middle,
  amount,
  indent = false,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  /** Optional centre cell (e.g. "3 paid"). Omit for a two-cell row. */
  middle?: string;
  /** Right-hand cell — an amount, or a plain count. */
  amount: string;
  indent?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={`w-full flex items-center gap-4 py-2 pr-2 text-left cursor-pointer hover:bg-marine/5 ${
        indent ? "pl-8 text-marine/80" : "pl-2 text-marine"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block w-3 shrink-0 text-marine/40 transition-transform ${
          open ? "rotate-90" : ""
        }`}
      >
        ▸
      </span>
      <span className="flex-1 truncate">{label}</span>
      {middle !== undefined && (
        <span className="w-28 shrink-0 text-right tabular-nums text-marine/60">{middle}</span>
      )}
      <span className="w-28 shrink-0 text-right tabular-nums">{amount}</span>
    </button>
  );
}
