import { test, expect } from "@playwright/test";
import {
  adminDb,
  createTestEvent,
  deleteEvent,
} from "../helpers/invite-fixtures";

// The public project runs unauthenticated — exactly the logged-out invitee the
// link is for. Each test asserts one cell of the members-only render matrix.
// We never submit the form (that would create a real registration / Stripe
// session / email on the shared DB); rendering is the contract under test.

const VALID_CODE = "E2EINVITECODE777";
const db = adminDb();

let eventId: string | undefined;

test.describe("Public invite link — members-only event gating", () => {
  test.beforeAll(async () => {
    eventId = await createTestEvent(db, {
      inviteCode: VALID_CODE,
      invitePrice: 50,
    });
  });

  test.afterAll(async () => {
    await deleteEvent(db, eventId);
  });

  test("no code → Apply block, no register form, secret code not leaked", async ({
    page,
  }) => {
    await page.goto(`/public/events/${eventId}`);
    await expect(page.getByRole("link", { name: /Apply for membership/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Register$/ })).toHaveCount(0);
    // The stored invite_code is read server-side only — it must never reach the client.
    expect(await page.content()).not.toContain(VALID_CODE);
  });

  test("valid code → register form + member-rate nudge + guest price", async ({
    page,
  }) => {
    await page.goto(`/public/events/${eventId}?code=${VALID_CODE}`);
    await expect(page.getByRole("button", { name: /^Register$/ })).toBeVisible();
    await expect(page.getByText(/member rate/i)).toBeVisible();
    await expect(page.getByText(/CHF\s*50\.00/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Apply for membership/i })).toHaveCount(0);
  });

  test("invalid/revoked code → 'no longer valid' notice + Apply block", async ({
    page,
  }) => {
    await page.goto(`/public/events/${eventId}?code=WRONGCODE123`);
    await expect(page.getByText(/no longer valid/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Apply for membership/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Register$/ })).toHaveCount(0);
  });

  test("valid code but guest price unset → 'not open yet', no free form", async ({
    page,
  }) => {
    // A code can exist before a price is set; the page must not advertise a
    // free Register button the register API would 500 on.
    const noPriceId = await createTestEvent(db, {
      inviteCode: "E2ENOPRICE7777AB",
      invitePrice: null,
    });
    try {
      await page.goto(`/public/events/${noPriceId}?code=E2ENOPRICE7777AB`);
      await expect(page.getByText(/isn.t open for this event yet/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /^Register$/ })).toHaveCount(0);
      await expect(page.getByText(/^Free$/)).toHaveCount(0);
    } finally {
      await deleteEvent(db, noPriceId);
    }
  });
});
