import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getPostmarkClient } from "@/lib/postmark";
import { redirect, notFound } from "next/navigation";
import EmailTemplateEditor from "@/components/admin/EmailTemplateEditor";

interface EmailTemplatePageProps {
  params: Promise<{ alias: string }>;
}

export default async function EmailTemplatePage({ params }: EmailTemplatePageProps) {
  const { alias } = await params;

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

  const client = getPostmarkClient();

  let template: {
    alias: string;
    name: string;
    subject: string;
    htmlBody: string;
    textBody: string;
  } | null = null;

  try {
    const t = await client.getTemplate(alias);
    template = {
      alias: t.Alias || alias,
      name: t.Name,
      subject: t.Subject || "",
      htmlBody: t.HtmlBody || "",
      textBody: t.TextBody || "",
    };
  } catch {
    notFound();
  }

  if (!template) notFound();

  return (
    <div>
      <div className="mb-8">
        <a
          href="/admin/email-templates"
          className="text-sm text-muted-foreground hover:text-marine font-body"
        >
          &larr; Email Templates
        </a>
      </div>
      <h1 className="font-heading text-3xl font-bold text-marine mb-2">
        {template.name}
      </h1>
      <p className="text-sm font-accent uppercase tracking-widest text-sky-dark mb-8">
        {template.alias}
      </p>
      <EmailTemplateEditor template={template} />
    </div>
  );
}
