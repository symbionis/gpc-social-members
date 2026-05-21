import { describe, it, expect } from "vitest";
import {
  computeCanSend,
  isBodyEmpty,
  buildSendConfirm,
} from "@/components/admin/event-messaging-state";

const base = {
  subjectEmpty: false,
  bodyEmpty: false,
  recipientCount: 5 as number | null,
  fetchingCount: false,
  sending: false,
};

describe("computeCanSend", () => {
  it("enables send when subject, body, and a positive resolved count are present", () => {
    expect(computeCanSend(base)).toBe(true);
  });

  it("disables when subject or body is empty", () => {
    expect(computeCanSend({ ...base, subjectEmpty: true })).toBe(false);
    expect(computeCanSend({ ...base, bodyEmpty: true })).toBe(false);
  });

  it("disables before a count fetch has completed", () => {
    expect(computeCanSend({ ...base, recipientCount: null })).toBe(false);
  });

  it("disables when the resolved audience is empty", () => {
    expect(computeCanSend({ ...base, recipientCount: 0 })).toBe(false);
  });

  it("disables while a fetch or send is in flight", () => {
    expect(computeCanSend({ ...base, fetchingCount: true })).toBe(false);
    expect(computeCanSend({ ...base, sending: true })).toBe(false);
  });
});

describe("isBodyEmpty", () => {
  it("treats markup with no text as empty", () => {
    expect(isBodyEmpty("")).toBe(true);
    expect(isBodyEmpty("<p></p>")).toBe(true);
    expect(isBodyEmpty("<p>  </p>")).toBe(true);
  });
  it("treats real text as non-empty", () => {
    expect(isBodyEmpty("<p>Hello</p>")).toBe(false);
  });
});

describe("buildSendConfirm", () => {
  it("names the registered audience for pre-event", () => {
    expect(
      buildSendConfirm({ subject: "Venue moved", kind: "event_pre", recipientCount: 12, includeNonConsented: false })
    ).toBe('Send "Venue moved" to 12 registered attendees?');
  });

  it("singularises a one-recipient send", () => {
    expect(
      buildSendConfirm({ subject: "Hi", kind: "event_post", recipientCount: 1, includeNonConsented: false })
    ).toBe('Send "Hi" to 1 checked-in attendee?');
  });

  it("calls out the consent override when on", () => {
    const msg = buildSendConfirm({
      subject: "Thanks",
      kind: "event_post",
      recipientCount: 30,
      includeNonConsented: true,
    });
    expect(msg).toContain("30 checked-in attendees");
    expect(msg).toContain("have not opted in to marketing");
  });

  it("does not call out consent for a normal post-event send", () => {
    const msg = buildSendConfirm({
      subject: "Thanks",
      kind: "event_post",
      recipientCount: 30,
      includeNonConsented: false,
    });
    expect(msg).not.toContain("opted in");
  });
});
