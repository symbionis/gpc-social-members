import { test, expect, type Page } from "@playwright/test";
import {
  adminDb,
  createTestEvent,
  deleteEvent,
  isEventsAdmin,
} from "../helpers/invite-fixtures";

// Drives the invite-link panel in Manage Event → Settings. Runs with the admin
// storageState from global-setup. The panel's mutations hit the admin-only
// invite-code endpoint, so the whole suite self-skips when the seeded test
// account lacks an events-admin role (true on a fresh/unseeded DB) — that keeps
// the spec correct and committed without going red in environments where the
// test admin isn't provisioned.

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "test@syks.co";
const db = adminDb();

// The Settings tab renders both EventCheckInSettings and EventInviteLink, so we
// scope every locator to the invite panel's <section> to avoid colliding with
// the check-in section's own Save/Copy controls.
function invitePanel(page: Page) {
  return page.locator("section", { hasText: "Private invite link" });
}

async function openSettings(page: Page, eventId: string) {
  await page.goto(`/admin/events/${eventId}/attendees`);
  await page.getByRole("button", { name: "Settings" }).click();
}

test.describe("Admin invite-link panel (Manage Event → Settings)", () => {
  let canRun = false;
  let blankId: string | undefined; // members-only, reg enabled, no code/price
  let seededId: string | undefined; // members-only with a code + price
  let publicId: string | undefined; // public event (panel must be hidden)
  let regOffId: string | undefined; // members-only, registration disabled

  test.beforeAll(async () => {
    canRun = await isEventsAdmin(db, ADMIN_EMAIL);
    if (!canRun) return;
    blankId = await createTestEvent(db, { invitePrice: null, inviteCode: null });
    seededId = await createTestEvent(db, {
      invitePrice: 50,
      inviteCode: "E2EADMINSEED7777",
    });
    publicId = await createTestEvent(db, { visibility: "public" });
    regOffId = await createTestEvent(db, {
      registrationEnabled: false,
      invitePrice: null,
    });
  });

  test.afterAll(async () => {
    await deleteEvent(db, blankId);
    await deleteEvent(db, seededId);
    await deleteEvent(db, publicId);
    await deleteEvent(db, regOffId);
  });

  test.beforeEach(() => {
    test.skip(
      !canRun,
      `${ADMIN_EMAIL} is not an events_admin+; seed an admin role to run these.`
    );
  });

  test("set a guest price, then generate an invite link", async ({ page }) => {
    await openSettings(page, blankId!);
    const panel = invitePanel(page);

    // Before a price is set, the link area is gated.
    await expect(panel.getByText(/Set a guest price/i)).toBeVisible();

    await panel.getByPlaceholder("e.g. 50").fill("40");
    await panel.getByRole("button", { name: /Save guest prices/i }).click();
    await expect(panel.getByText(/^Saved$/)).toBeVisible();

    // First generation has no existing link, so it must NOT prompt a confirm
    // (this test registers no dialog handler — a stray confirm would be
    // auto-dismissed and the link would never generate).
    await panel.getByRole("button", { name: /Generate invite link/i }).click();
    await expect(
      panel.getByLabel("Invite link", { exact: true })
    ).toHaveValue(new RegExp(`/public/events/${blankId}\\?code=`), { timeout: 10000 });
  });

  test("regenerate replaces the existing link", async ({ page }) => {
    page.on("dialog", (d) => d.accept()); // accept the confirm()
    await openSettings(page, seededId!);
    const panel = invitePanel(page);

    const before = await panel.getByLabel("Invite link", { exact: true }).inputValue();
    expect(before).toContain("?code=");

    await panel.getByRole("button", { name: /Regenerate invite link/i }).click();
    await expect(panel.getByText(/New link generated/i)).toBeVisible();
    await expect(panel.getByLabel("Invite link", { exact: true })).not.toHaveValue(before);
  });

  test("registration disabled → prerequisite reason, no link", async ({ page }) => {
    await openSettings(page, regOffId!);
    const panel = invitePanel(page);
    await expect(panel.getByText(/Enable registration/i)).toBeVisible();
    await expect(panel.getByLabel("Invite link", { exact: true })).toHaveCount(0);
  });

  test("public event → invite panel is not shown", async ({ page }) => {
    await openSettings(page, publicId!);
    await expect(invitePanel(page)).toHaveCount(0);
  });
});
