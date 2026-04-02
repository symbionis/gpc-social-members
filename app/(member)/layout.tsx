import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import MemberNav from "@/components/member/MemberNav";
import MemberFooter from "@/components/member/MemberFooter";

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login");
  }

  const adminClient = createAdminClient();
  const { data: member } = await adminClient
    .from("members")
    .select("id, first_name, last_name, status, member_number")
    .eq("email", user.email)
    .single();

  if (!member) {
    redirect("/login?error=no_account");
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <MemberNav member={member} />
      <main className="flex-1 mx-auto w-full max-w-4xl px-4 py-8">{children}</main>
      <MemberFooter />
    </div>
  );
}
