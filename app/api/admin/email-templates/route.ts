import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPostmarkClient } from "@/lib/postmark";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: admins } = await adminClient
    .from("admin_users")
    .select("role")
    .eq("email", user.email)
    .limit(1);

  if (admins?.[0]?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getPostmarkClient();
  const result = await client.getTemplates({ count: 100, offset: 0 });

  const templates = result.Templates.map((t) => ({
    templateId: t.TemplateId,
    alias: t.Alias || null,
    name: t.Name,
    active: t.Active,
  }));

  return NextResponse.json({ templates });
}
