import { test, expect } from "@playwright/test";
import {
  adminDb,
  createTestEvent,
  deleteEvent,
  isEventsAdmin,
} from "../helpers/invite-fixtures";

// Drives the printable events flyer at /print/events-flyer. Runs with the admin
// storageState from global-setup. Like the invite-link suite, it self-skips when
// the seeded test account lacks an events-admin role (true on a fresh/unseeded
// DB) so it stays committed and green where the test admin isn't provisioned.

const ADMIN_EMAIL = "test@syks.co";
const FLYER_URL = "/print/events-flyer";
const db = adminDb();

const CONFIRMED_TITLE = "E2E Flyer CONFIRMED (safe to delete)";
const UNCONFIRMED_TITLE = "E2E Flyer UNCONFIRMED (safe to delete)";

test.describe("Events PDF flyer (/print/events-flyer)", () => {
  let canRun = false;
  let confirmedId: string | undefined;
  let unconfirmedId: string | undefined;

  test.beforeAll(async () => {
    canRun = await isEventsAdmin(db, ADMIN_EMAIL);
    if (!canRun) return;

    // Published + confirmed → must appear on the flyer.
    confirmedId = await createTestEvent(db, { title: CONFIRMED_TITLE });
    await db.from("events").update({ is_confirmed: true }).eq("id", confirmedId);

    // Published but NOT confirmed → must be excluded (the flyer is stricter than
    // the member /events page).
    unconfirmedId = await createTestEvent(db, { title: UNCONFIRMED_TITLE });
    await db.from("events").update({ is_confirmed: false }).eq("id", unconfirmedId);
  });

  test.afterAll(async () => {
    await deleteEvent(db, confirmedId);
    await deleteEvent(db, unconfirmedId);
  });

  test.beforeEach(() => {
    test.skip(
      !canRun,
      `${ADMIN_EMAIL} is not an events_admin+; seed an admin role to run these.`
    );
  });

  test("renders confirmed+published events with header/footer CTA and QR", async ({
    page,
  }) => {
    await page.goto(FLYER_URL);

    await expect(
      page.getByRole("heading", { name: "Upcoming Events" })
    ).toBeVisible();

    // CTA appears in both header and footer (two instances of message + URL).
    await expect(
      page.getByText(/please log in to the member portal to register/i)
    ).toHaveCount(2);
    await expect(
      page.getByText("https://social.genevapolo.com/events")
    ).toHaveCount(2);

    // A QR is rendered (qrcode.react emits an <svg>); header + footer = 2.
    await expect(page.locator(".flyer svg")).toHaveCount(2);

    // Confirmed event shows; unconfirmed does not.
    await expect(page.getByText(CONFIRMED_TITLE)).toBeVisible();
    await expect(page.getByText(UNCONFIRMED_TITLE)).toHaveCount(0);
  });

  test("unauthenticated request is redirected to admin login", async ({
    browser,
  }) => {
    // Fresh context without the admin storageState.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const anon = await ctx.newPage();
    await anon.goto(FLYER_URL);
    await expect(anon).toHaveURL(/\/admin\/login/);
    await ctx.close();
  });
});
