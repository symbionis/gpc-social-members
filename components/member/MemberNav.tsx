"use client";

import { signOut } from "@/app/actions/auth";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { cn } from "@/lib/utils";

interface MemberNavProps {
  member: {
    first_name: string;
    last_name: string;
    member_number: string | null;
  };
}

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/card", label: "My Card" },
  { href: "/profile", label: "Profile" },
];

export default function MemberNav({ member }: MemberNavProps) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleSignOut() {
    await signOut();
    // Unlink the browser session from this member. Guarded so a posthog
    // failure can never strand the user on a signed-out page.
    try {
      posthog.reset();
    } catch {
      /* analytics must never block the post-logout redirect */
    }
    router.push("/login");
  }

  return (
    <header className="bg-marine text-white">
      <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="font-heading leading-tight">
            <span className="text-lg font-bold block">Geneva Polo Club</span>
            <span className="text-xs font-light tracking-widest uppercase block">Social Members</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-body transition-colors",
                  pathname === link.href
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/70 font-body hidden sm:block">
            {member.first_name} {member.last_name}
          </span>
          <button
            onClick={handleSignOut}
            className="text-sm text-white/60 hover:text-white font-body transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}
