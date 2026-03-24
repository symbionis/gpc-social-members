import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import ProfileForm from "@/components/member/ProfileForm";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const adminClient = createAdminClient();

  const { data: members } = await adminClient
    .from("members")
    .select(
      "id, first_name, last_name, email, phone, company, role_title, metadata"
    )
    .eq("email", user.email)
    .limit(1);

  const member = members?.[0];
  if (!member) redirect("/login");

  // Check if member is also an originator
  const { data: originators } = await adminClient
    .from("admin_users")
    .select("id, invite_code")
    .eq("email", user.email)
    .eq("is_originator", true)
    .limit(1);

  const originator = originators?.[0];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Profile
      </h1>
      <ProfileForm member={member} />

      {/* Referral section for originators */}
      {originator?.invite_code && (
        <div className="mt-8 bg-white rounded-xl border border-border p-6">
          <h2 className="font-heading text-xl font-bold text-marine mb-4">
            Your Referral Link
          </h2>
          <div className="bg-cream rounded-lg p-4">
            <p className="text-xs text-muted-foreground font-body mb-1">
              Share this link to invite new members
            </p>
            <p className="text-sm font-body text-marine break-all">
              {appUrl}/apply/{originator.invite_code}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
