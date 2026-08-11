// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// The real scanner wants a camera, which jsdom has not got. Stand in a button that fires the
// same onDecode the camera would, so the phases after a scan are reachable.
vi.mock("@/components/door/CredentialScanner", () => ({
  default: ({ onDecode }: { onDecode: (v: string) => void }) => (
    <button type="button" onClick={() => onDecode("cred-token")}>
      simulate scan
    </button>
  ),
}));
vi.mock("@/components/common/PhoneInput", () => ({
  default: ({ disabled }: { disabled?: boolean }) => <input aria-label="Phone" disabled={disabled} />,
}));

import ScanCheckIn from "@/components/door/ScanCheckIn";

/** Drive the scanner to the point where the server has asked for a waiver. */
async function scanIntoWaiver(user: ReturnType<typeof userEvent.setup>) {
  render(<ScanCheckIn eventId="evt-1" />);
  await user.click(screen.getByRole("button", { name: /Scan a ticket/ }));
  await user.click(screen.getByRole("button", { name: "simulate scan" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ status: "needs_waiver", name: "Ana Vidal" }) });
});

describe("ScanCheckIn — the waiver is the shared modal", () => {
  it("raises the shared waiver modal when the scan comes back needs_waiver", async () => {
    const user = userEvent.setup();
    const dialog = await scanIntoWaiver(user);

    // The same component the roster path renders — same heading, same portal target.
    expect(within(dialog).getByText("Terms & waiver")).toBeInTheDocument();
    expect(within(dialog).getByText("Ana Vidal")).toBeInTheDocument();
    expect(dialog.parentElement).toBe(document.body);
  });

  it("will not submit until the guest ticks the acceptance box", async () => {
    const user = userEvent.setup();
    const dialog = await scanIntoWaiver(user);
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    const accept = within(dialog).getByRole("button", { name: "Accept" });
    expect(accept).toBeDisabled();

    fetchMock.mockClear();
    await user.click(accept);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-submits with the acceptance the guest gave", async () => {
    const user = userEvent.setup();
    const dialog = await scanIntoWaiver(user);
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockClear();
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      token: "cred-token",
      waiverAccepted: true,
      language: "en",
      marketingConsent: true,
    });
  });

  it("carries the guest's language choice through to the submission", async () => {
    const user = userEvent.setup();
    const dialog = await scanIntoWaiver(user);
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    await user.click(within(dialog).getByRole("button", { name: "FR" }));
    // Chrome and body switch together — this path used to translate both, and must still.
    expect(within(dialog).getByText("Conditions et décharge")).toBeInTheDocument();

    fetchMock.mockClear();
    await user.click(within(dialog).getByRole("checkbox", { name: /J'ai lu et j'accepte/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accepter" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      language: "fr",
    });
  });

  it("dismissing the waiver closes the scanner and checks nobody in", async () => {
    const user = userEvent.setup();
    const dialog = await scanIntoWaiver(user);
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockClear();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A server fault is not a verdict about the guest's ticket. A non-ok response carrying JSON
  // with no `error` key — a framework 500, a proxy 502 — used to skip the error branch and land
  // on the result screen, whose fallback reads "Ticket not recognised". The operator sent the
  // guest away to the roster because the server had failed.
  it.each([
    ["a non-ok body with no error key", { ok: false, status: 500, json: async () => ({}) }],
    ["a non-ok body that is not JSON", {
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError("no"); },
    }],
  ])("does not blame the ticket for %s", async (_label, response) => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ScanCheckIn eventId="evt-1" />);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response);

    await user.click(screen.getByRole("button", { name: /Scan a ticket/ }));
    await user.click(screen.getByRole("button", { name: "simulate scan" }));

    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/not recognised/i)).toBeNull();
    errorSpy.mockRestore();
  });

  // The severe shape, and the one that isolates the `!res.ok` guard: a FAILED request whose
  // body still carries a recognised status. Under the old `!res.ok && data.error` the error
  // branch was skipped, the status was read at face value, and a 500 rendered the success
  // screen — router.refresh() and all — for a guest the server never checked in.
  it("does not admit on a non-ok response that carries a checked_in status", async () => {
    const user = userEvent.setup();
    render(<ScanCheckIn eventId="evt-1" />);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ status: "checked_in", name: "Ana Vidal" }),
    });

    await user.click(screen.getByRole("button", { name: /Scan a ticket/ }));
    await user.click(screen.getByRole("button", { name: "simulate scan" }));

    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/checked in/i)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  // The acceptance a guest has just given must survive a failed submit. Dropping to the
  // scanner unmounts the modal, which resets it, so the guest re-reads and re-ticks the whole
  // waiver with a queue behind them.
  it("keeps the guest's acceptance on screen when the waiver submit fails", async () => {
    const user = userEvent.setup();
    const dialog = await scanIntoWaiver(user);
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Server fell over" }) });
    await user.click(within(dialog).getByRole("checkbox", { name: /I have read and accept/i }));
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));

    // Still open, still the same guest, with the failure shown inside it.
    const stillOpen = await screen.findByRole("dialog");
    expect(within(stillOpen).getByText("Ana Vidal")).toBeInTheDocument();
    expect(within(stillOpen).getByText("Server fell over")).toBeInTheDocument();
    // And the tick is still there, so retrying is one tap rather than a re-read.
    expect(within(stillOpen).getByRole("checkbox", { name: /I have read and accept/i })).toBeChecked();
  });

  // An unknown status is the route saying something this screen cannot read. It must not be
  // rendered to an operator as a verdict about the ticket.
  it("refuses, and logs, a status it does not recognise", async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ScanCheckIn eventId="evt-1" />);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "quarantined" }),
    });

    await user.click(screen.getByRole("button", { name: /Scan a ticket/ }));
    await user.click(screen.getByRole("button", { name: "simulate scan" }));

    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/not recognised/i)).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unrecognised status"),
      expect.objectContaining({ status: "quarantined" })
    );
    errorSpy.mockRestore();
  });

  // A genuine not_recognised still reaches the result screen — the refusal the operator is
  // meant to see. Without this the tests above would pass by suppressing everything.
  it("still shows a genuine not_recognised as a result", async () => {
    const user = userEvent.setup();
    render(<ScanCheckIn eventId="evt-1" />);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "not_recognised" }),
    });

    await user.click(screen.getByRole("button", { name: /Scan a ticket/ }));
    await user.click(screen.getByRole("button", { name: "simulate scan" }));

    expect(await screen.findByText(/not recognised/i)).toBeInTheDocument();
  });
});
