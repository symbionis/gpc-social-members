import "./print.css";

// Minimal-chrome layout for printable artifacts. Deliberately renders no admin
// sidebar or member nav so the on-screen view matches what prints. Nested under
// the root layout, which provides <html>/<body> and fonts.
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-cream">{children}</div>;
}
