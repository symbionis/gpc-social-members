// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import WaiverModal, { type WaiverAcceptance } from "@/components/events/WaiverModal";

// The component every acceptance in the app now goes through — door scan, door roster, and
// the guest's own ticket page. It had no tests of its own: its behaviour was only ever
// observed through consumers, and that is exactly how the reset bug survived. Each consumer
// happened to mount a FRESH instance per guest, so a test could tick one box, look at another
// instance, and see an unticked one — proving nothing about the reset at all.
//
// These drive the component directly, so the reuse case is reachable.

const tick = /I have read and accept/i;
const acceptBtn = "Accept";

/** A host that keeps ONE modal instance mounted and swaps who it is for — the ScanCheckIn
 *  shape ("Scan next guest" never closes the modal), and the one no consumer test covers. */
function Reusable({ onAccept }: { onAccept?: (a: WaiverAcceptance) => void }) {
  const [guest, setGuest] = useState("Ana Ruiz");
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setGuest("Ben Torres")}>next guest</button>
      <button onClick={() => setOpen(false)}>close</button>
      <button onClick={() => setOpen(true)}>reopen</button>
      <WaiverModal
        open={open}
        guestName={guest}
        onAccept={onAccept ?? (() => {})}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

afterEach(cleanup);

describe("WaiverModal", () => {
  it("keeps Accept disabled until the affirmation is ticked", async () => {
    const user = userEvent.setup();
    render(<WaiverModal open guestName="Ana Ruiz" onAccept={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: acceptBtn })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: tick }));
    expect(screen.getByRole("button", { name: acceptBtn })).toBeEnabled();
  });

  // The acceptance carries the language actually read and the consent state — and no version.
  // A client that could name its own version could attest to text the guest never saw.
  it("reports the language read and the consent, and never a waiver version", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<WaiverModal open guestName="Ana Ruiz" onAccept={onAccept} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "FR" }));
    await user.click(screen.getByRole("checkbox", { name: /J'ai lu et j'accepte/i }));
    await user.click(screen.getByRole("button", { name: "Accepter" }));
    expect(onAccept).toHaveBeenCalledWith({ language: "fr", marketingConsent: true });
    expect(Object.keys(onAccept.mock.calls[0][0])).toEqual(["language", "marketingConsent"]);
  });

  // Chrome and body must move together. They diverged once before — the roster modal switched
  // the document while its own labels stayed English — and the version hash cannot tell.
  it("switches the chrome and the waiver body to the same language", async () => {
    const user = userEvent.setup();
    render(<WaiverModal open guestName="Ana Ruiz" onAccept={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Terms & waiver")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "FR" }));
    expect(screen.getByText("Conditions et décharge")).toBeInTheDocument();
    expect(screen.queryByText("Terms & waiver")).not.toBeInTheDocument();
  });

  // THE regression this file exists for. One instance, two guests, no close in between.
  it("clears the affirmation when the guest changes while it stays open", async () => {
    const user = userEvent.setup();
    render(<Reusable />);
    await user.click(screen.getByRole("checkbox", { name: tick }));
    expect(screen.getByRole("checkbox", { name: tick })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "next guest" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Ben Torres")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: tick })).not.toBeChecked();
    expect(screen.getByRole("button", { name: acceptBtn })).toBeDisabled();
  });

  // Same instance, closed and reopened for the same person: `open: false` renders null but does
  // NOT unmount, so the state survives unless the reset runs.
  it("clears the affirmation when reopened on the same instance", async () => {
    const user = userEvent.setup();
    render(<Reusable />);
    await user.click(screen.getByRole("checkbox", { name: tick }));
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.getByRole("checkbox", { name: tick })).not.toBeChecked();
  });

  // A guest who read it in French, then the next guest opening in French too, would be a
  // language chosen by the previous person rather than this one.
  it("returns to the default language for the next guest", async () => {
    const user = userEvent.setup();
    render(<Reusable />);
    await user.click(screen.getByRole("button", { name: "FR" }));
    expect(screen.getByText("Conditions et décharge")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "next guest" }));
    expect(screen.getByText("Terms & waiver")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <WaiverModal open={false} guestName="Ana Ruiz" onAccept={() => {}} onClose={() => {}} />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
