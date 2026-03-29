import Link from "next/link";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-border/40">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-heading text-xl font-bold text-marine">
            Geneva Polo Social Members Club
          </Link>
          <Link
            href="/login"
            className="text-sm font-body text-marine/70 hover:text-marine transition-colors"
          >
            Member Login
          </Link>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-border/40 py-8 mt-auto">
        <div className="mx-auto max-w-5xl px-6 text-center text-sm text-muted-foreground font-body">
          &copy; {new Date().getFullYear()} Geneva Polo Club — Social Member
          Club
        </div>
      </footer>
    </div>
  );
}
