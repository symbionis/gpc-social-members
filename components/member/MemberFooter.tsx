import Link from "next/link";

export default function MemberFooter() {
  return (
    <footer className="mt-12 border-t border-border/60">
      <div className="mx-auto max-w-4xl px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-body text-muted-foreground">
        <span>&copy; {new Date().getFullYear()} Geneva Polo Club — Social Members</span>
        <div className="flex items-center gap-4">
          <Link href="/terms" className="hover:text-marine transition-colors underline underline-offset-4">
            Terms &amp; Conditions
          </Link>
          <span className="text-border">·</span>
          <Link href="/regulations" className="hover:text-marine transition-colors underline underline-offset-4">
            Internal Regulations
          </Link>
        </div>
      </div>
    </footer>
  );
}
