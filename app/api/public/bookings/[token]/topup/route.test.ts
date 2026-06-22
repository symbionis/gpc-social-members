import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/events/roster", () => ({ mintRegistrationTickets: vi.fn() }));

import { POST } from "@/app/api/public/bookings/[token]/topup/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

const mockedAdmin = vi.mocked(createAdminClient);
const mockedStripe = vi.mocked(getStripe);

const TYPE = "33333333-3333-3333-3333-333333333333";

// reg → booking; event_ticket_types → priced type; topups insert → {id}; rpc → applied.
function adminClient(opts: { reg?: Record<string, unknown> | null; price?: number | null }) {
  return {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.limit = () => c;
      c.insert = () => c;
      c.maybeSingle = async () => {
        if (table === "event_registrations")
          return {
            data:
              "reg" in opts
                ? opts.reg
                : { id: "reg", event_id: "evt", is_member: true, status: "paid", email: "l@x.com" },
            error: null,
          };
        if (table === "event_registration_topups") return { data: { id: "topup-1" }, error: null };
        return { data: null, error: null };
      };
      (c as { then: unknown }).then = (resolve: (r: unknown) => unknown) => {
        if (table === "event_ticket_types")
          return resolve({
            data: [{ id: TYPE, title: "Adult", price_member: opts.price ?? 25, price_non_member: 40, archived_at: null }],
            error: null,
          });
        return resolve({ data: [], error: null });
      };
      return c;
    },
    rpc: async () => ({ data: { status: "applied", added: 1 }, error: null }),
  } as unknown as ReturnType<typeof createAdminClient>;
}

function post(body: unknown, token = "mtok") {
  const req = new Request(`http://localhost/api/public/bookings/${token}/topup`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req as never, { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue(adminClient({}));
  mockedStripe.mockReturnValue({
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: "https://stripe.test/cs" }) } },
  } as never);
});

describe("POST /api/public/bookings/[token]/topup", () => {
  it("requires at least one item", async () => {
    const res = await post({ items: [] });
    expect(res.status).toBe(400);
  });

  it("404s an unknown booking", async () => {
    mockedAdmin.mockReturnValue(adminClient({ reg: null }));
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 1 }] });
    expect(res.status).toBe(404);
  });

  it("creates a Stripe checkout for a paid top-up", async () => {
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checkoutUrl: "https://stripe.test/cs" });
  });

  it("applies a free top-up immediately without checkout", async () => {
    mockedAdmin.mockReturnValue(adminClient({ price: 0 }));
    const res = await post({ items: [{ ticketTypeId: TYPE, quantity: 2 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: true });
  });
});
