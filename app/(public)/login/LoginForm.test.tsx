// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// No `globals: true` in vitest config, so testing-library's auto-cleanup isn't
// registered — unmount between tests ourselves or the DOM accumulates.
afterEach(cleanup);

const mocks = vi.hoisted(() => ({
  sendOtpCode: vi.fn(),
  verifyOtpCode: vi.fn(),
  push: vi.fn(),
  identify: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: { identify: mocks.identify } }));
vi.mock("@/app/actions/auth", () => ({
  sendOtpCode: mocks.sendOtpCode,
  verifyOtpCode: mocks.verifyOtpCode,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}));

import LoginForm from "@/app/(public)/login/LoginForm";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendOtpCode.mockResolvedValue({ error: null });
  mocks.verifyOtpCode.mockResolvedValue({ error: null, redirect: "/welcome", identity: null });
});

/** Advance past the email step and hand back the six code inputs. */
async function reachCodeStep() {
  const user = userEvent.setup();
  render(<LoginForm />);
  await user.type(screen.getByLabelText("Email address"), "member@example.com");
  await user.click(screen.getByRole("button", { name: "Send Sign-In Code" }));
  const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
  expect(boxes).toHaveLength(6);
  return { user, boxes };
}

describe("OTP entry — iOS one-time-code autofill", () => {
  // The Chrome-iOS regression. iOS hands the emailed code to the box carrying
  // `autocomplete="one-time-code"` as one six-character string, not as one
  // digit per box. The old handler took `value.slice(-1)`, so five digits went
  // in the bin, the code never completed, and nothing submitted.
  it("spreads a whole code autofilled into the first box across all six", async () => {
    const { boxes } = await reachCodeStep();

    await act(async () => {
      fireEvent.change(boxes[0], { target: { value: "123456" } });
    });

    expect(screen.getAllByRole("textbox").map((b) => (b as HTMLInputElement).value)).toEqual(
      ["1", "2", "3", "4", "5", "6"],
    );
    expect(mocks.verifyOtpCode).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtpCode).toHaveBeenCalledWith("member@example.com", "123456", "member");
  });

  it("keeps digits separate when they arrive as six one-per-box events", async () => {
    const { boxes } = await reachCodeStep();

    await act(async () => {
      boxes.forEach((box, i) => fireEvent.change(box, { target: { value: String(i + 1) } }));
    });

    expect(mocks.verifyOtpCode).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtpCode).toHaveBeenCalledWith("member@example.com", "123456", "member");
  });

  it("submits once when the digits arrive one at a time", async () => {
    const { user, boxes } = await reachCodeStep();

    for (let i = 0; i < 6; i++) {
      await user.type(boxes[i], String(i + 1));
    }

    expect(mocks.verifyOtpCode).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtpCode).toHaveBeenCalledWith("member@example.com", "123456", "member");
  });

  it("submits a pasted code exactly once", async () => {
    const { boxes } = await reachCodeStep();

    await act(async () => {
      fireEvent.paste(boxes[0], { clipboardData: { getData: () => "123456" } });
    });

    expect(mocks.verifyOtpCode).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtpCode).toHaveBeenCalledWith("member@example.com", "123456", "member");
  });

  it("does not resubmit the same digits when the component re-renders", async () => {
    // A rejected code must be retryable, but an unrelated re-render while six
    // digits sit in state must not fire a second verify.
    mocks.verifyOtpCode.mockResolvedValue({ error: "Invalid code", redirect: null, identity: null });
    const { boxes } = await reachCodeStep();

    await act(async () => {
      boxes.forEach((box, i) => fireEvent.change(box, { target: { value: String(i + 1) } }));
    });

    expect(mocks.verifyOtpCode).toHaveBeenCalledTimes(1);
    // The failed attempt clears the boxes, so nothing is pending resubmission.
    expect(screen.getAllByRole("textbox").every((b) => (b as HTMLInputElement).value === "")).toBe(true);
  });
});

describe("OTP entry — affordances and error state", () => {
  it("marks only the first box as the one-time-code target", async () => {
    const { boxes } = await reachCodeStep();
    expect(boxes[0]).toHaveAttribute("autocomplete", "one-time-code");
    for (const box of boxes.slice(1)) {
      expect(box).toHaveAttribute("autocomplete", "off");
    }
  });

  it("offers the email field for autofill", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email address")).toHaveAttribute("autocomplete", "email");
  });

  it("clears a rejected-code error as soon as a new digit is typed", async () => {
    mocks.verifyOtpCode.mockResolvedValue({ error: "Invalid code", redirect: null, identity: null });
    const { user, boxes } = await reachCodeStep();

    await act(async () => {
      boxes.forEach((box, i) => fireEvent.change(box, { target: { value: String(i + 1) } }));
    });
    expect(screen.getByText("Invalid code")).toBeInTheDocument();

    await user.type(screen.getAllByRole("textbox")[0], "9");
    expect(screen.queryByText("Invalid code")).not.toBeInTheDocument();
  });

  it("keeps the step-two buttons out of form submission", async () => {
    await reachCodeStep();
    expect(screen.getByRole("button", { name: "Resend code" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Use a different email" })).toHaveAttribute("type", "button");
  });
});
