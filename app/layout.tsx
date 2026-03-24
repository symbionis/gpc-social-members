import type { Metadata, Viewport } from "next";
import { Playfair_Display, Poppins, Teko } from "next/font/google";
import "./globals.css";

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
  title: "Geneva Polo Club — Social Member Club",
  description:
    "Exclusive membership community of the Geneva Polo Club Social Member Club.",
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
  return (
    <html
      lang="en"
      className={`${playfairDisplay.variable} ${poppins.variable} ${teko.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
