// Minimal layout for the public door check-in page: no site header/footer nav,
// so the kiosk-style flow stays focused. The root layout still provides html,
// fonts, global styles, and analytics.
export default function CheckInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
