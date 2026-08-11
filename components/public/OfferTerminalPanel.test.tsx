// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import OfferTerminalPanel from "./OfferTerminalPanel";

afterEach(cleanup);

describe("OfferTerminalPanel", () => {
  it("renders the invalid-link panel", () => {
    render(<OfferTerminalPanel kind="invalid" />);
    expect(screen.getByText(/link isn't valid/i)).toBeInTheDocument();
  });

  it("renders the offer-closed panel", () => {
    render(<OfferTerminalPanel kind="closed" />);
    expect(screen.getByText(/offer is closed/i)).toBeInTheDocument();
  });

  it("renders the members-only panel", () => {
    render(<OfferTerminalPanel kind="members_only" />);
    expect(screen.getByText(/for members only/i)).toBeInTheDocument();
  });

  it("renders the seats-gone panel without any waitlist copy or CTA", () => {
    render(<OfferTerminalPanel kind="seats_gone" />);
    expect(screen.getByText(/seats have gone/i)).toBeInTheDocument();
    expect(screen.queryByText(/waitlist/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the already-registered panel naming the event and reference code, with no manage_token in its HTML", () => {
    const { container } = render(
      <OfferTerminalPanel
        kind="already_registered"
        eventTitle="Summer Gala"
        referenceCode="EV-ABC123"
      />
    );
    expect(screen.getByText(/already registered/i)).toBeInTheDocument();
    expect(screen.getByText("Summer Gala")).toBeInTheDocument();
    expect(screen.getByText("EV-ABC123")).toBeInTheDocument();
    expect(screen.getByText(/confirmation email/i)).toBeInTheDocument();
    // No manage_token — the panel must not carry or link the party's manage secret.
    expect(container.innerHTML).not.toMatch(/manage_token|manage-token|manage_url/i);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});

// The one terminal outcome that can follow a SUCCESSFUL redemption. The free path redirects
// back to the offer link with ?registered=1, by which time the registration exists — so the
// gate resolves to already-registered and the reader, who has just registered, was told they
// were "already registered" and sent looking for an email that had not arrived yet.
describe("OfferTerminalPanel — just registered", () => {
  it("congratulates rather than turning away when the registration was just made", () => {
    render(
      <OfferTerminalPanel
        kind="already_registered"
        eventTitle="Sunset Chukkers"
        referenceCode="EV-RXMBGGFM"
        justRegistered
      />
    );

    expect(screen.getByText("You're registered")).toBeInTheDocument();
    expect(screen.queryByText(/already have a registration/)).toBeNull();
    expect(screen.getByText(/on its way/)).toBeInTheDocument();
    // The reference still has to be there — it is what the club asks for.
    expect(screen.getByText("EV-RXMBGGFM")).toBeInTheDocument();
  });

  it("keeps the you-already-have-one framing on a plain revisit", () => {
    render(
      <OfferTerminalPanel
        kind="already_registered"
        eventTitle="Sunset Chukkers"
        referenceCode="EV-RXMBGGFM"
      />
    );

    expect(screen.getByText(/already have a registration/)).toBeInTheDocument();
    expect(screen.getByText(/Look for the manage-booking link/)).toBeInTheDocument();
  });
});
