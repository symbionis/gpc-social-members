# Best Practices Research: GPC Social Members MVP

Researched 2026-03-24. Sources: Supabase official docs, Stripe official docs, Next.js official docs, Postmark.js SDK docs, qrcode.react docs, community guides.

---

## 1. Supabase Auth with Magic Link in Next.js App Router

### 1.1 Package Setup

Install two packages:

```bash
npm install @supabase/supabase-js @supabase/ssr
```

`@supabase/ssr` is the official package for server-side auth in Next.js. It manages sessions via cookies rather than localStorage, which is required for the App Router.

### 1.2 Client Utilities

Create two Supabase client factories. These are the foundation of every auth and data call.

**`lib/supabase/client.ts`** -- for Client Components (browser):

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

**`lib/supabase/server.ts`** -- for Server Components, Server Actions, Route Handlers:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component -- safe to ignore.
            // The middleware/proxy handles cookie refresh.
          }
        },
      },
    }
  );
}
```

### 1.3 Magic Link Sign-In

Supabase uses `signInWithOtp` for magic links. Despite the method name, it sends a magic link by default.

```ts
const { data, error } = await supabase.auth.signInWithOtp({
  email: userEmail,
  options: {
    shouldCreateUser: false, // IMPORTANT: do not auto-create auth users
    emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm`,
  },
});
```

**Key decisions for this project:**

- Set `shouldCreateUser: false` because member records already exist in the `members` table. The auth user should only be created when a member is approved and activated, not on every magic link attempt.
- The `emailRedirectTo` must be listed in Supabase Dashboard > Auth > URL Configuration > Redirect URLs.

**PKCE flow (recommended for App Router):** Edit the Magic Link email template in Supabase Dashboard to use `token_hash`:

```html
<h2>Magic Link</h2>
<p>Follow this link to login:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Log In</a></p>
```

Then at `/auth/confirm`, exchange the hash for a session:

```ts
// app/auth/confirm/route.ts
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "email";
  const next = searchParams.get("next") ?? "/dashboard";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
```

### 1.4 Middleware for Route Protection

Next.js 16 renames `middleware.ts` to `proxy.ts`. Create two files:

**`proxy.ts`** (project root):

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**`lib/supabase/proxy.ts`**:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Always use getUser(), never getSession(), on the server.
  // getUser() validates the token with Supabase Auth; getSession() does not.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Route protection logic
  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") ||
                      request.nextUrl.pathname.startsWith("/apply") ||
                      request.nextUrl.pathname.startsWith("/auth");
  const isMemberRoute = request.nextUrl.pathname.startsWith("/dashboard") ||
                        request.nextUrl.pathname.startsWith("/card") ||
                        request.nextUrl.pathname.startsWith("/profile");
  const isAdminRoute = request.nextUrl.pathname.startsWith("/admin");

  if (!user && (isMemberRoute || isAdminRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // For admin routes, check admin_users table in a Server Component
  // (not in middleware -- keep middleware fast)

  return supabaseResponse;
}
```

**Critical rule from Supabase docs:** Never trust `supabase.auth.getSession()` inside server code. Always use `supabase.auth.getUser()` which revalidates the auth token with the Supabase Auth server on every call.

### 1.5 Linking auth.users to Custom Tables (members, admin_users)

The standard Supabase pattern is a foreign key from your custom table to `auth.users.id`. Your schema already has this via the `auth_user_id` column on `members` and `admin_users`.

**Recommended approach for this project:**

1. Admin creates a member record first (status = pending/approved).
2. On approval, the system creates a Supabase auth user via the Admin API (service role) or the member signs in with magic link for the first time.
3. A database trigger or Server Action links `members.auth_user_id` to the new `auth.users.id`.

**Trigger pattern from Supabase docs:**

```sql
create function public.handle_new_user()
returns trigger
set search_path = ''
as $$
begin
  -- Link to existing member record by email
  update public.members
  set auth_user_id = new.id
  where email = new.email and auth_user_id is null;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

**Determining user type after login (member vs admin):**

```ts
// In a Server Component or Server Action
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

if (user) {
  // Check admin_users first
  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, role, is_originator, is_approval_committee")
    .eq("auth_user_id", user.id)
    .single();

  if (admin) {
    // Redirect to admin panel
  }

  // Then check members
  const { data: member } = await supabase
    .from("members")
    .select("id, status, tier_id")
    .eq("auth_user_id", user.id)
    .single();

  if (member && member.status === "active") {
    // Redirect to member portal
  }
}
```

---

## 2. Stripe Checkout Integration for Membership Payments

### 2.1 Creating Products and Prices

Create one Stripe Product per membership tier, each with a one-time Price in EUR. Amounts are in cents.

**Via the Stripe Dashboard (recommended for initial setup):**

1. Go to Products > Create product.
2. Name: "Classic Membership 2026", price: One-time, 500.00 EUR.
3. Repeat for Elite (1000 EUR), Corporate S (3000 EUR), Corporate M (6000 EUR), Corporate L (12000 EUR).
4. Record each `price_id` (format: `price_xxxxx`) and store in your `membership_tiers.stripe_price_id` column.

**Via API (for automation):**

```ts
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const product = await stripe.products.create({
  name: "Classic Membership 2026",
  metadata: { tier: "classic", season: "2026" },
});

const price = await stripe.prices.create({
  product: product.id,
  unit_amount: 50000, // 500.00 EUR in cents
  currency: "eur",
});
// Store price.id in membership_tiers.stripe_price_id
```

### 2.2 Creating Checkout Sessions on Approval

When an admin approves a member, generate a Checkout Session. Use `mode: "payment"` for one-time payments (not subscriptions).

```ts
// app/api/stripe/checkout/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const { memberId } = await request.json();

  // Verify admin permission with supabase
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // ... verify admin role ...

  // Get member and tier details
  const { data: member } = await supabase
    .from("members")
    .select("*, membership_tiers(*)")
    .eq("id", memberId)
    .single();

  if (!member || member.status !== "approved") {
    return NextResponse.json({ error: "Member not approved" }, { status: 400 });
  }

  // Skip Stripe for free-tier members
  if (!member.membership_tiers.stripe_price_id) {
    // Mark as active directly, no payment needed
    await supabase
      .from("members")
      .update({ status: "active" })
      .eq("id", memberId);
    return NextResponse.json({ free: true });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price: member.membership_tiers.stripe_price_id,
        quantity: 1,
      },
    ],
    customer_email: member.email,
    currency: "eur",
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/cancel`,
    metadata: {
      member_id: member.id,
      tier_id: member.tier_id,
      season: "2026",
    },
  });

  return NextResponse.json({ url: session.url });
}
```

### 2.3 Webhook Handling for Payment Confirmation

**Critical:** In Next.js App Router, use `request.text()` to get the raw body. Do NOT parse JSON first.

```ts
// app/api/webhooks/stripe/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Use service role client for webhooks (no user session)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const body = await request.text(); // RAW body, not .json()
  const signature = request.headers.get("stripe-signature")!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status === "paid") {
        const memberId = session.metadata?.member_id;

        // Update member status to active
        await supabaseAdmin
          .from("members")
          .update({ status: "active" })
          .eq("id", memberId);

        // Record payment
        await supabaseAdmin.from("payments").insert({
          member_id: memberId,
          amount: session.amount_total! / 100,
          currency: session.currency,
          stripe_payment_id: session.payment_intent as string,
          status: "paid",
          season_id: session.metadata?.season,
        });

        // Generate membership card (trigger or function call)
        // ... card generation logic ...
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
```

**Important from Stripe docs:** Do not rely on the redirect to `success_url` alone. Malicious users could access the URL directly, or users may close the browser before redirect. Always use webhooks to confirm payment.

### 2.4 Handling Free-Tier Members

For members who don't need to pay (admin-designated free tier, or migrated members):

- Skip Checkout Session creation entirely.
- Admin marks them active directly via the admin panel.
- Insert a payment record with `status: "free"` and `amount: 0` for audit trail.

### 2.5 Testing

- Use Stripe test mode keys during development.
- Test card: `4242 4242 4242 4242`, any future date, any CVC.
- Use Stripe CLI for local webhook testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`

---

## 3. Postmark Transactional Email in Next.js

### 3.1 SDK Setup

```bash
npm install postmark
```

```ts
// lib/email/postmark.ts
import * as postmark from "postmark";

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN!);

export default client;
```

Add to `.env`:
```
POSTMARK_SERVER_TOKEN=<from Postmark dashboard>
POSTMARK_FROM_EMAIL=membership@genevapolo.club
```

### 3.2 Sending Emails with Templates

Postmark templates are managed in the Postmark dashboard. Use `sendEmailWithTemplate` for all transactional emails.

```ts
// lib/email/send.ts
import client from "./postmark";

interface EmailOptions {
  to: string;
  templateAlias: string;
  templateModel: Record<string, any>;
}

export async function sendEmail({ to, templateAlias, templateModel }: EmailOptions) {
  return client.sendEmailWithTemplate({
    From: process.env.POSTMARK_FROM_EMAIL!,
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: templateModel,
  });
}
```

### 3.3 Email Template Patterns

Create these templates in Postmark dashboard with these aliases:

**`welcome-member`** -- sent when member is approved:

```ts
await sendEmail({
  to: member.email,
  templateAlias: "welcome-member",
  templateModel: {
    member_name: `${member.first_name} ${member.last_name}`,
    tier_name: member.membership_tiers.name,
    payment_url: checkoutSession.url, // or null for free tier
    club_name: "Geneva Polo Club",
  },
});
```

**`application-received`** -- sent on signup:

```ts
await sendEmail({
  to: member.email,
  templateAlias: "application-received",
  templateModel: {
    member_name: `${member.first_name} ${member.last_name}`,
    club_name: "Geneva Polo Club",
  },
});
```

**`application-declined`** -- sent when admin declines:

```ts
await sendEmail({
  to: member.email,
  templateAlias: "application-declined",
  templateModel: {
    member_name: `${member.first_name} ${member.last_name}`,
    club_name: "Geneva Polo Club",
  },
});
```

**`payment-confirmed`** -- sent after successful payment (from webhook):

```ts
await sendEmail({
  to: member.email,
  templateAlias: "payment-confirmed",
  templateModel: {
    member_name: `${member.first_name} ${member.last_name}`,
    tier_name: tierName,
    amount: formattedAmount,
    member_number: member.member_number,
    portal_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    club_name: "Geneva Polo Club",
  },
});
```

### 3.4 Best Practices

- **From Postmark docs:** Send emails from Server Actions or Route Handlers only, never from client code.
- **From Postmark docs:** Do not send emails with large attachments in request handlers. If attachment emails are needed later, use a background job.
- **Template management:** Use Postmark template aliases (not IDs) so you can update templates without code changes.
- **Error handling:** Wrap all sends in try/catch and log failures. Postmark has excellent deliverability, but network failures happen.

---

## 4. PWA Setup for Next.js

### 4.1 Web App Manifest

Next.js App Router has built-in manifest support. Create a dynamic manifest file:

**`app/manifest.ts`:**

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Geneva Polo Club - Social Member Club",
    short_name: "GPC Members",
    description: "Geneva Polo Club Social Member Club membership portal",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#052938", // Marine Blue
    theme_color: "#052938",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
```

### 4.2 Minimal Service Worker

For the MVP, a minimal service worker is sufficient. The primary goal is enabling "Add to Home Screen", not full offline support.

**`public/sw.js`:**

```js
// Minimal service worker for PWA install capability
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Basic cache for the membership card page (most important offline use case)
const CACHE_NAME = "gpc-v1";
const OFFLINE_URLS = ["/dashboard", "/card"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
});

self.addEventListener("fetch", (event) => {
  // Network-first strategy
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
```

### 4.3 Service Worker Registration

Register the service worker from a client component:

```tsx
// components/ServiceWorkerRegistration.tsx
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }
  }, []);

  return null;
}
```

Include this component in your root layout.

### 4.4 Security Headers for Service Worker

From Next.js official PWA guide, add headers in `next.config.js`:

```js
module.exports = {
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};
```

### 4.5 Add to Home Screen

Requirements for "Add to Home Screen" prompt:
1. Valid web app manifest (created above).
2. Website served over HTTPS (Railway provides this).
3. A registered service worker.

On iOS (16.4+), users must manually tap Share > Add to Home Screen. You can display an instruction banner for iOS users. On Android/Chrome, the browser may show an automatic install prompt.

### 4.6 What You Do NOT Need for MVP

- No need for `next-pwa` or `serwist` packages. The built-in manifest and a hand-written service worker are sufficient.
- No need for full offline support. Network-first with a basic cache fallback is fine.
- No need for push notifications in Phase 1.

---

## 5. QR Code Generation in Next.js

### 5.1 Library: qrcode.react

The best library for QR codes in React. High reputation, actively maintained, 4 million+ weekly downloads.

```bash
npm install qrcode.react
```

### 5.2 Basic Usage

Two components are available: `QRCodeSVG` (recommended) and `QRCodeCanvas`.

```tsx
import { QRCodeSVG } from "qrcode.react";

function MembershipCard({ cardNumber, memberId }: {
  cardNumber: string;
  memberId: string;
}) {
  // Encode a URL that the admin scanner will open
  const qrValue = `${process.env.NEXT_PUBLIC_APP_URL}/verify/${cardNumber}`;

  return (
    <QRCodeSVG
      value={qrValue}
      size={200}
      level="M"           // Medium error correction
      bgColor="#FFFFFF"
      fgColor="#052938"    // Marine Blue
      marginSize={2}
      title={`Membership card QR code for ${cardNumber}`}
    />
  );
}
```

### 5.3 Props Reference

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `value` | `string` | required | The data to encode |
| `size` | `number` | 128 | Size in pixels |
| `level` | `"L" \| "M" \| "Q" \| "H"` | `"L"` | Error correction level |
| `bgColor` | CSS color | `#FFFFFF` | Background color |
| `fgColor` | CSS color | `#000000` | Foreground (dot) color |
| `marginSize` | `number` | 0 | Quiet zone in modules |
| `title` | `string` | -- | Accessibility label |
| `imageSettings` | `object` | -- | Embed a logo in center |

### 5.4 Embedding a Logo

To embed the club crest in the QR code center:

```tsx
<QRCodeSVG
  value={qrValue}
  size={256}
  level="H"  // High error correction needed when embedding images
  fgColor="#052938"
  imageSettings={{
    src: "/images/gpc-crest.png",
    height: 48,
    width: 48,
    excavate: true, // Clear modules behind the image
  }}
/>
```

**Important:** When embedding an image, use `level="H"` (highest error correction) to ensure the QR code remains scannable despite the obscured center area.

### 5.5 QR Value Strategy

For the fieldside check-in use case, encode a URL:

```
https://members.genevapolo.club/verify/GPC-XXXX-XXXX
```

The `/verify/[cardNumber]` route can be an admin-only page that:
1. Looks up the card number in `membership_cards`.
2. Shows the member's name, photo, tier, and validity status.
3. Works on mobile (the admin scans with their phone camera, which opens the URL).

This approach requires no special scanner app -- any phone camera or QR reader opens the verification URL.

### 5.6 Responsive QR Code

Pass custom styles for responsive rendering:

```tsx
<QRCodeSVG
  value={qrValue}
  size={256}
  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
/>
```

---

## Environment Variables Summary

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://rmchkoktpzoojlglyfca.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from dashboard>
SUPABASE_SERVICE_ROLE_KEY=<from dashboard>

# Stripe
STRIPE_SECRET_KEY=<from Stripe dashboard>
STRIPE_PUBLISHABLE_KEY=<from Stripe dashboard>
STRIPE_WEBHOOK_SECRET=<from Stripe dashboard or CLI>

# Postmark
POSTMARK_SERVER_TOKEN=<from Postmark dashboard>
POSTMARK_FROM_EMAIL=membership@genevapolo.club

# App
NEXT_PUBLIC_APP_URL=https://members.genevapolo.club
```

---

## Key Architectural Decisions

1. **Use `@supabase/ssr` with cookie-based sessions**, not the vanilla JS client with localStorage. This is required for App Router server-side auth.

2. **Use `proxy.ts` (Next.js 16) not `middleware.ts`** for session refresh. Keep it lightweight -- only refresh the auth token. Do role checks in Server Components.

3. **Use Stripe Checkout (hosted page) with `mode: "payment"`** for one-time membership fees. Do not build a custom payment form. Checkout handles PCI compliance, 3D Secure, and European payment methods automatically.

4. **Use Postmark templates** managed in the Postmark dashboard. This lets non-developers edit email copy without code deployments.

5. **Use a hand-written minimal service worker** for PWA. No need for next-pwa or serwist for the MVP.

6. **Use `qrcode.react` with SVG output** for membership card QR codes. Encode a verification URL, not raw data.

7. **Never trust `getSession()` on the server.** Always use `getUser()` which revalidates against Supabase Auth.

---

## Sources

- [Supabase: Passwordless Email Logins (Magic Link)](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase: Next.js Server-Side Auth Guide](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase: Build a User Management App with Next.js](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs)
- [Stripe: Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe: Webhook Signature Verification](https://docs.stripe.com/webhooks/signature)
- [Stripe: Webhook Signing with Next.js App Router](https://github.com/stripe/stripe-node/blob/master/examples/webhook-signing/nextjs/app/api/webhooks/route.ts)
- [Next.js: Progressive Web Apps Guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Postmark.js SDK Documentation](https://github.com/activecampaign/postmark.js)
- [Postmark: Send Email with API](https://postmarkapp.com/developer/user-guide/send-email-with-api)
- [qrcode.react Documentation](https://github.com/zpao/qrcode.react)
