import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDoorRoster, rosterTypeTotals } from "@/lib/events/door-roster";
import DoorRosterSheet from "@/components/events/DoorRosterSheet";

// Always render fresh: gated on live auth, and a roster cached even briefly could send
// staff to the door with a stale list.
export const dynamic = "force-dynamic";

export default async function DoorRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Auth runs before any roster data is fetched — an unauthorized request never
  // touches the tickets query.
  await requireAdminUser();

  const { id } = await params;
  const roster = await buildDoorRoster(createAdminClient(), id);

  if (roster.status === "not_found") notFound();
  // A failed load must never render as an empty sheet — that would send staff to the
  // door with a confident-but-wrong roster. Fail loud, exactly as the CSV export does.
  if (roster.status === "error") {
    throw new Error(`Could not load the door roster (${roster.scope})`);
  }

  return (
    <DoorRosterSheet
      event={roster.event}
      parties={roster.parties}
      typeTotals={rosterTypeTotals(roster.parties)}
    />
  );
}
