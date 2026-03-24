import { createAdminClient } from "@/lib/supabase/admin";

export default async function AdminDashboardPage() {
  const supabase = createAdminClient();

  // Fetch stats in parallel
  const [
    { count: pendingCount },
    { count: activeCount },
    { count: totalCount },
    { data: tierBreakdown },
    { data: recentMembers },
  ] = await Promise.all([
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("members")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("membership_tiers")
      .select("id, name, price_cents, category"),
    supabase
      .from("members")
      .select("id, first_name, last_name, email, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const stats = [
    {
      label: "Pending Applications",
      value: pendingCount ?? 0,
      accent: true,
    },
    { label: "Active Members", value: activeCount ?? 0 },
    { label: "Total Members", value: totalCount ?? 0 },
  ];

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Dashboard
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`p-6 rounded-xl border ${
              stat.accent
                ? "bg-sky/10 border-sky/30"
                : "bg-white border-border"
            }`}
          >
            <p className="text-sm font-body text-muted-foreground">
              {stat.label}
            </p>
            <p className="text-3xl font-heading font-bold text-marine mt-1">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl border border-border">
        <div className="p-6 border-b border-border">
          <h2 className="font-heading text-xl font-bold text-marine">
            Recent Members
          </h2>
        </div>
        <div className="divide-y divide-border">
          {recentMembers?.map((member: Record<string, unknown>) => (
            <div
              key={member.id as string}
              className="px-6 py-4 flex items-center justify-between"
            >
              <div>
                <p className="font-body font-medium text-marine">
                  {member.first_name as string} {member.last_name as string}
                </p>
                <p className="text-sm text-muted-foreground font-body">
                  {member.email as string}
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-body font-medium ${
                  member.status === "active"
                    ? "bg-green-100 text-green-800"
                    : member.status === "pending"
                      ? "bg-amber-100 text-amber-800"
                      : member.status === "approved"
                        ? "bg-sky/20 text-sky-dark"
                        : "bg-gray-100 text-gray-600"
                }`}
              >
                {member.status as string}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
