"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function markWelcomeSeen(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) return { error: "Unauthorized" };

  const adminClient = createAdminClient();

  // Get current metadata
  const { data: member } = await adminClient
    .from("members")
    .select("id, metadata")
    .eq("email", user.email)
    .single();

  if (!member) return { error: "Member not found" };

  const metadata = (member.metadata as Record<string, unknown>) || {};

  await adminClient
    .from("members")
    .update({ metadata: { ...metadata, welcome_seen: true } })
    .eq("id", member.id);

  return {};
}
