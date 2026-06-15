# Geneva Polo Social Club

Members platform for the Geneva Polo Social Club — applications and onboarding,
membership tiers and billing, a digital membership card, broadcast messaging, and a
live event check-in flow. Admin, member, and door-staff surfaces in one system.

Production: <https://social.genevapolo.com>

## Stack

- **Frontend:** Next.js (App Router) + TypeScript, Tailwind, shadcn/ui
- **Backend:** Supabase — Postgres with row-level security, Auth; server logic in
  Next.js Route Handlers
- **Payments:** Stripe (membership tiers & billing)
- **Email:** Postmark (transactional + broadcast streams)

## Develop

```sh
npm install
cp .env.example .env.local      # Supabase, Stripe, Postmark keys
npm run dev                     # http://localhost:3000
npm run build
```

## Tests

```sh
npm run test          # full suite
npm run test:admin    # admin surfaces
npm run test:member   # member surfaces
npm run test:public   # public / check-in flows
npm run test:unit     # unit tests
```

## Structure

```
app/
├── (admin)/admin/      Applications, members & tiers, events & attendees,
│                       messaging (drafts, scheduling), email templates,
│                       originators, scheduled jobs, dashboard
├── (member)/           Membership card, dashboard, events, profile
└── (checkin)/          Door check-in (door/[id]), public event check-in,
                        registration tokens (registrations/[token])
```

Auth gates the three surfaces by role; RLS enforces access at the database.
