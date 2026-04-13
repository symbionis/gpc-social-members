import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com https://*.stripe.com https://js.stripe.com",
              "img-src 'self' data: blob: https://*.stripe.com https://*.supabase.co",
              "connect-src 'self' https://*.stripe.com https://*.supabase.co https://api.postmarkapp.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
