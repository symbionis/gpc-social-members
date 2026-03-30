import Link from "next/link";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="absolute top-0 left-0 right-0 z-10">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="font-heading leading-tight">
            <span className="text-lg font-bold text-white block">Geneva Polo Club</span>
            <span className="text-[10px] font-light tracking-[0.25em] uppercase text-sky block">Social Members</span>
          </Link>
          <Link
            href="/login"
            className="text-sm font-body text-white/70 hover:text-white transition-colors"
          >
            Member Login
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-marine-dark py-8">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-white/30 font-body">
          &copy; {new Date().getFullYear()} Geneva Polo Club — Social Members
          Club
        </div>
      </footer>
    </div>
  );
}
