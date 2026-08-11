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
});
