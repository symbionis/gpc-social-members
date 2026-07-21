import { test, expect } from "@playwright/test";
import { adminDb, createTestEvent, deleteEvent } from "../helpers/invite-fixtures";

// Public project = unauthenticated, i.e. a logged-out non-member. We exercise
// the per-type quantity grid's RENDER + stepper interaction but never submit:
// submitting would create a real registration / Stripe session on the shared
// DB. The items[] payload contract is covered by the register-route unit tests
// (app/api/events/[id]/register/route.test.ts).

const db = adminDb();
let eventId: string | undefined;

test.describe("Public event registration — per-type quantity grid", () => {
  test.beforeAll(async () => {
    eventId = await createTestEvent(db, {
      visibility: "public",
      title: "E2E ticket-types test (safe to delete)",
      ticketTypes: [
        { title: "Standard", price_member: 80, price_non_member: 120 },
        { title: "Kids", price_member: 40, price_non_member: 60 },
      ],
    });
  });

  test.afterAll(async () => {
    await deleteEvent(db, eventId);
  });

  test("renders per-type steppers + running total (logged-out non-member rates)", async ({
    page,
  }) => {
    await page.goto(`/public/events/${eventId}`);

    // Sidebar shows a "From <cheapest>" summary across the two types.
    await expect(page.getByText(/From\s+CHF\s*60\.00/)).toBeVisible();

    // Open the registration drawer.
    await page.getByRole("button", { name: /Reserve your spot/ }).click();
    const dialog = page.getByRole("dialog", { name: /Register for/i });

    // Both types listed at non-member prices.
    await expect(dialog.getByText("Standard")).toBeVisible();
    await expect(dialog.getByText("Kids")).toBeVisible();
    await expect(dialog.getByText(/CHF\s*120\.00/)).toBeVisible();
    await expect(dialog.getByText(/CHF\s*60\.00/)).toBeVisible();

    // Total starts at CHF 0.00.
    await expect(dialog.getByText(/CHF\s*0\.00/)).toBeVisible();

    // Add 2× Standard + 1× Kids via the steppers.
    await dialog.getByRole("button", { name: /Add one Standard ticket/i }).click();
    await dialog.getByRole("button", { name: /Add one Standard ticket/i }).click();
    await dialog.getByRole("button", { name: /Add one Kids ticket/i }).click();

    // Running total = 2×120 + 1×60 = CHF 300.00.
    await expect(dialog.getByText(/CHF\s*300\.00/)).toBeVisible();

    // Intentionally NOT submitted — the contract under test is the grid render.
  });
});
