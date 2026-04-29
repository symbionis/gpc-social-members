import type { Metadata, Viewport } from "next";
import { Playfair_Display, Poppins, Teko } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const teko = Teko({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-accent",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Geneva Polo Social Club",
  description:
    "Exclusive membership community of the Geneva Polo Social Club.",
};

export const viewport: Viewport = {
  themeColor: "#052938",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Pass Supabase public config via data attributes so the client can read them
  // at request time. This is the fallback for Railway where NEXT_PUBLIC_ vars
  // are available at runtime but not baked into the bundle at build time.
  return (
    <html
      lang="en"
      className={`${playfairDisplay.variable} ${poppins.variable} ${teko.variable}`}
    >
      <body
        data-supabase-url={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}
        data-supabase-anon-key={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}
      >
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
