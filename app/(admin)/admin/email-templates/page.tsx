import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getPostmarkClient } from "@/lib/postmark";
import { redirect } from "next/navigation";
import EmailTemplateList from "@/components/admin/EmailTemplateList";

export default async function EmailTemplatesPage() {
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

  if (admins?.[0]?.role !== "super_admin") redirect("/admin/dashboard");

  // Fetch Postmark templates
  const client = getPostmarkClient();
  let templates: {
    templateId: number;
    alias: string | null;
    name: string;
    active: boolean;
  }[] = [];

  try {
    const result = await client.getTemplates({ count: 100, offset: 0 });
    templates = result.Templates.map((t) => ({
      templateId: t.TemplateId,
      alias: t.Alias || null,
      name: t.Name,
      active: t.Active,
    }));
  } catch (error) {
    console.error("Failed to fetch Postmark templates:", error);
  }

  // Fetch email settings
  const { data: settings } = await adminClient
    .from("email_settings")
    .select("*")
    .order("key");

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-8">
        Email Templates
      </h1>
      <EmailTemplateList
        templates={templates}
        settings={settings || []}
      />
    </div>
  );
}
