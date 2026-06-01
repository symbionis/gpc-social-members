import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import BroadcastComposer, {
  type InitialDraft,
} from "@/components/admin/BroadcastComposer";

export default async function EditDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/admin/login");

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("role")
    .eq("email", user.email)
    .limit(1);

  const role = admins?.[0]?.role;
  if (role !== "super_admin" && role !== "team_admin") redirect("/admin/dashboard");

  const [{ data: draft }, { data: tiers }] = await Promise.all([
    adminClient
      .from("broadcasts")
      .select("id, subject, body_html, audience_filter, status")
      .eq("id", id)
      .eq("status", "draft")
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("membership_tiers")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  if (!draft) notFound();

  const initialDraft: InitialDraft = {
    id: draft.id,
    subject: draft.subject,
    body_html: draft.body_html,
    audience_filter: (draft.audience_filter ??
      null) as InitialDraft["audience_filter"],
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-marine">
            Edit draft
          </h1>
          <p className="text-sm font-body text-muted-foreground mt-1">
            Pick up where you left off. Sender:{" "}
            <strong>contact@genevapolo.com</strong>.
          </p>
        </div>
        <Link
          href="/admin/messages?tab=drafts"
          className="text-sm font-body text-muted-foreground hover:text-marine"
        >
          ← Back to drafts
        </Link>
      </div>

      <BroadcastComposer tiers={tiers ?? []} initialDraft={initialDraft} />
    </div>
  );
}
