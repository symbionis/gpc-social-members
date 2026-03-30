import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPostmarkClient } from "@/lib/postmark";
import { NextResponse, type NextRequest } from "next/server";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("role")
    .eq("email", user.email)
    .limit(1);

  if (admins?.[0]?.role !== "super_admin") return null;
  return user;
}

interface RouteParams {
  params: Promise<{ alias: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await requireSuperAdmin();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { alias } = await params;
  const client = getPostmarkClient();

  try {
    const template = await client.getTemplate(alias);
    return NextResponse.json({
      templateId: template.TemplateId,
      alias: template.Alias,
      name: template.Name,
      subject: template.Subject,
      htmlBody: template.HtmlBody,
      textBody: template.TextBody,
      active: template.Active,
    });
  } catch (error) {
    console.error(`Failed to fetch template ${alias}:`, error);
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await requireSuperAdmin();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { alias } = await params;
  const { subject, htmlBody, textBody } = await request.json();

  const client = getPostmarkClient();

  try {
    await client.editTemplate(alias, {
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`Failed to update template ${alias}:`, error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}
