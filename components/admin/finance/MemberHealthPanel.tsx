import type { MemberHealth } from "@/lib/admin/finance";

interface Props {
  health: MemberHealth;
}

export default function MemberHealthPanel({ health }: Props) {
  const renewalPct = `${Math.round(health.renewalRate * 100)}%`;

  return (
    <section className="rounded-xl bg-white border border-marine/10 p-6 space-y-4">
      <h2 className="font-heading text-xl font-bold text-marine">Member health</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label="Active" value={String(health.active)} />
        <Stat label="Expired" value={String(health.expired)} />
        <Stat label="Pending" value={String(health.pending)} />
        <Stat label="Suspended" value={String(health.suspended)} />
        <Stat label="New members (period)" value={String(health.newMembers)} />
        <Stat
          label="Renewal rate"
          value={renewalPct}
          title="Of members whose membership ended in this period, the share currently active."
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div title={title}>
      <div className="text-xs uppercase tracking-wide text-marine/50 font-body flex items-center gap-1">
        {label}
        {title && <span className="text-marine/30">ⓘ</span>}
      </div>
      <div className="mt-1 font-heading text-xl font-bold text-marine">{value}</div>
    </div>
  );
}
