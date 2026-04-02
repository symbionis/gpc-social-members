"use client";

import { signOut } from "@/app/actions/auth";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type AdminUser = Database["public"]["Tables"]["admin_users"]["Row"];

interface AdminSidebarProps {
  admin: AdminUser;
}

export default function AdminSidebar({ admin }: AdminSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const isSuper = admin.role === "super_admin";
  const isOriginator = admin.role === "originator";

  const navLinks = isOriginator
    ? [
        { href: "/admin/originators", label: "My Referrals", icon: "share" },
      ]
    : [
        { href: "/admin/dashboard", label: "Dashboard", icon: "grid" },
        ...(admin.is_approval_committee || isSuper
          ? [
              {
                href: "/admin/applications",
                label: "Applications",
                icon: "inbox",
              },
            ]
          : []),
        { href: "/admin/members", label: "Members", icon: "users" },
        { href: "/admin/events", label: "Events", icon: "calendar" },
        { href: "/admin/lounge", label: "Lounge", icon: "coffee" },
        ...(admin.is_originator || isSuper
          ? [
              {
                href: "/admin/originators",
                label: "Originators",
                icon: "share",
              },
            ]
          : []),
        ...(isSuper
          ? [
              { href: "/admin/tiers", label: "Tiers", icon: "layers" },
              { href: "/admin/users", label: "Users", icon: "shield" },
              { href: "/admin/email-templates", label: "Email Templates", icon: "mail" },
            ]
          : []),
      ];

  async function handleSignOut() {
    await signOut();
    router.push("/admin/login");
  }

  return (
    <aside className="w-64 bg-marine text-white flex flex-col min-h-screen">
      <div className="p-6 border-b border-white/10">
        <h1 className="font-heading text-lg font-bold">Geneva Polo Social Members Club</h1>
        <p className="text-xs text-white/50 font-body mt-1">Administration</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body transition-colors",
              pathname === link.href
                ? "bg-white/15 text-white"
                : "text-white/60 hover:text-white hover:bg-white/10"
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-white/10">
        <div className="text-sm font-body text-white/70 mb-2">
          {admin.first_name} {admin.last_name}
        </div>
        <div className="text-xs text-white/40 font-body mb-3 capitalize">
          {admin.role.replace("_", " ")}
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm text-white/50 hover:text-white font-body transition-colors"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
