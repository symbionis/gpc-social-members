import { test, expect } from "@playwright/test";
import { adminDb, createTestEvent, deleteEvent } from "../helpers/invite-fixtures";

// Drives the printable events flyer's CONTENT at /print/events-flyer. Runs with
// the admin storageState from global-setup, like every other spec in this
// project — the page calls requireAdminUser(), so a non-admin session fails here
// exactly as it already does in admin/dashboard, members, tiers and the rest.
//
// Deliberately ungated. This suite used to self-skip unless a hardcoded email
// held an events-admin role, which meant it never ran at all; and the role check
// was the wrong one, since requireAdminUser() only requires an admin_users row.
// Fixtures below need no role either — adminDb() is service-role.
//
// The route's auth guard is NOT covered here — that assertion needs no admin and
// no fixtures, so it lives in e2e/public/print-routes-auth.spec.ts and executes
// on every run.

const FLYER_URL = "/print/events-flyer";
const db = adminDb();

const CONFIRMED_TITLE = "E2E Flyer CONFIRMED (safe to delete)";
const UNCONFIRMED_TITLE = "E2E Flyer UNCONFIRMED (safe to delete)";

test.describe("Events PDF flyer (/print/events-flyer)", () => {
  let confirmedId: string | undefined;
  let unconfirmedId: string | undefined;

  test.beforeAll(async () => {
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
});
