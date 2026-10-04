// Story 4.8: the one gate on whether the body is this page's to drive.
import { describe, expect, it } from "vitest";
import {
  CONNECTION_DOWN,
  connectionReason,
  createBodyControl,
} from "../../../src/input/body-control";

describe("createBodyControl", () => {
  it("is open until a reason is raised, and open again when the last is cleared", () => {
    const control = createBodyControl();
    expect(control.isOpen()).toBe(true);
    control.setReason("a", true);
    control.setReason("b", true);
    control.setReason("a", false);
    expect(control.isOpen()).toBe(false);
    control.setReason("b", false);
    expect(control.isOpen()).toBe(true);
  });

  it("raising a reason twice, or clearing one never raised, changes nothing else", () => {
    const control = createBodyControl();
    control.setReason("a", true);
    control.setReason("a", true);
    control.setReason("zzz", false);
    control.setReason("a", false);
    expect(control.isOpen()).toBe(true);
  });
});

describe("connectionReason", () => {
  it("closes on a drop after having connected, and opens on the next connected", () => {
    const control = createBodyControl();
    const feed = connectionReason(control);
    feed("connecting");
    feed("connected");
    expect(control.isOpen()).toBe(true);
    feed("disconnected");
    expect(control.isOpen()).toBe(false);
    feed("connected");
    expect(control.isOpen()).toBe(true);
  });

  it("never closes a page that has not yet connected", () => {
    const control = createBodyControl();
    const feed = connectionReason(control);
    feed("connecting");
    feed("disconnected");
    feed("disconnected");
    expect(control.isOpen()).toBe(true);
  });

  it("a second reason is added without touching the connection's", () => {
    const control = createBodyControl();
    const feed = connectionReason(control);
    feed("connected");
    control.setReason("another-tab", true);
    feed("disconnected");
    feed("connected");
    expect(control.isOpen()).toBe(false);
    control.setReason("another-tab", false);
    expect(control.isOpen()).toBe(true);
    expect(CONNECTION_DOWN).toBe("connection-down");
  });
});
