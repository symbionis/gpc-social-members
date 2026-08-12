import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import PostHogProvider from "@/components/PostHogProvider";

// Self-hosted (next/font/local), not next/font/google: the Google Fonts build fetches
// happen over the network at BUILD time, and a Railway build once failed outright when it
// couldn't reach fonts.gstatic.com (repeated fetch failures on the Teko file, see PR #128's
// first deploy). Self-hosting removes that network dependency from the build entirely. Files
// are the same Google-published latin-subset woff2s, just vendored into the repo.
const playfairDisplay = localFont({
  src: "./fonts/playfair-display-variable.woff2",
  weight: "400 900",
  variable: "--font-heading",
  display: "swap",
});

const poppins = localFont({
  src: [
    { path: "./fonts/poppins-200.woff2", weight: "200", style: "normal" },
    { path: "./fonts/poppins-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/poppins-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/poppins-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/poppins-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/poppins-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

const teko = localFont({
  src: [
    { path: "./fonts/teko-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/teko-400.woff2", weight: "400", style: "normal" },
  ],
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
        data-posthog-key={process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ""}
        data-posthog-host={process.env.NEXT_PUBLIC_POSTHOG_HOST ?? ""}
      >
        <PostHogProvider>{children}</PostHogProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
