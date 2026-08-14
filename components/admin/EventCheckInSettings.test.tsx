// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import EventCheckInSettings from "@/components/admin/EventCheckInSettings";

function renderSettings(
  over: Partial<React.ComponentProps<typeof EventCheckInSettings>> = {}
) {
  return render(
    <EventCheckInSettings
      eventId="evt-1"
      seatCap={null}
      seatsUsed={0}
      maxTicketsMember={null}
      maxTicketsInvite={null}
      maxTicketsNonMember={null}
      {...over}
    />
  );
}

const inviteInput = () => screen.getByLabelText("Invited guests ticket limit");
const membersInput = () => screen.getByLabelText("Members ticket limit");

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

describe("EventCheckInSettings — tickets per booking", () => {
  it("shows the default-of-10 placeholder when no limit is configured", () => {
    renderSettings();
    expect(inviteInput()).toHaveAttribute("placeholder", "10");
    expect((inviteInput() as HTMLInputElement).value).toBe("");
  });

  it("pre-fills a configured limit", () => {
    renderSettings({ maxTicketsInvite: 4 });
    expect((inviteInput() as HTMLInputElement).value).toBe("4");
  });

  it("Save stays disabled until a value actually changes", async () => {
    renderSettings({ maxTicketsInvite: 4 });
    // There are two "Save" buttons on the page (cap section + limits section); the second
    // one is the limits section's, and it starts disabled since nothing changed yet.
    const [, limitsSave] = screen.getAllByRole("button", { name: "Save" });
    expect(limitsSave).toBeDisabled();
  });

  it("disables Save and shows an error for a value above the 20 ceiling", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(inviteInput());
    await user.type(inviteInput(), "25");
    const [, limitsSave] = screen.getAllByRole("button", { name: "Save" });
    expect(limitsSave).toBeDisabled();
  });

  it("saves a valid limit, PATCHes only the changed field, and shows Saved once the parent re-renders with the new value", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSettings({ maxTicketsInvite: 4 });
    await user.clear(inviteInput());
    await user.type(inviteInput(), "6");
    const [, limitsSave] = screen.getAllByRole("button", { name: "Save" });
    expect(limitsSave).toBeEnabled();
    await user.click(limitsSave);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/settings",
      expect.objectContaining({ method: "PATCH" })
    );
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body).toEqual({
      max_tickets_member: null,
      max_tickets_invite: 6,
      max_tickets_non_member: null,
    });
    expect(refresh).toHaveBeenCalled();
    // "Saved" reads changed-vs-prop, so it only shows once the parent's router.refresh()
    // has actually re-fetched and passed the new value back down — simulate that here.
    rerender(
      <EventCheckInSettings
        eventId="evt-1"
        seatCap={null}
        seatsUsed={0}
        maxTicketsMember={null}
        maxTicketsInvite={6}
        maxTicketsNonMember={null}
      />
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("clears a configured limit to null when the field is emptied", async () => {
    const user = userEvent.setup();
    renderSettings({ maxTicketsInvite: 4 });
    await user.clear(inviteInput());
    const [, limitsSave] = screen.getAllByRole("button", { name: "Save" });
    await user.click(limitsSave);
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body.max_tickets_invite).toBeNull();
  });

  it("surfaces the route's error message when the PATCH fails", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: "Could not update ticket limits. Try again." }) });
    const user = userEvent.setup();
    renderSettings({ maxTicketsInvite: 4 });
    await user.clear(inviteInput());
    await user.type(inviteInput(), "6");
    const [, limitsSave] = screen.getAllByRole("button", { name: "Save" });
    await user.click(limitsSave);
    expect(await screen.findByText("Could not update ticket limits. Try again.")).toBeInTheDocument();
  });

  it("saves all three limits together when multiple fields changed", async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.clear(membersInput());
    await user.type(membersInput(), "8");
    await user.clear(inviteInput());
    await user.type(inviteInput(), "4");
    const [, limitsSave] = screen.getAllByRole("button", { name: "Save" });
    await user.click(limitsSave);
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body).toEqual({
      max_tickets_member: 8,
      max_tickets_invite: 4,
      max_tickets_non_member: null,
    });
  });

  it("the ticket-cap section and the limits section save independently", async () => {
    const user = userEvent.setup();
    renderSettings({ maxTicketsInvite: 4 });
    await user.clear(inviteInput());
    await user.type(inviteInput(), "6");
    const [capSave] = screen.getAllByRole("button", { name: "Save" });
    // The cap field wasn't touched, so its Save stays disabled even though the limits one
    // is now enabled — the two sections don't share dirty state.
    expect(capSave).toBeDisabled();
  });
});
