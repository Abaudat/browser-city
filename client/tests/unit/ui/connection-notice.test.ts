// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConnectionNoticeHandle,
  type ConnectionStatus,
  mountConnectionNotice,
} from "../../../src/ui/connection-notice";

function mount(overrides: Partial<Parameters<typeof mountConnectionNotice>[0]> = {}) {
  return mountConnectionNotice({
    container: document.body,
    debounceMs: 1000,
    recoveredHoldMs: 1500,
    fadeMs: 300,
    ...overrides,
  });
}

function noticeText(): string {
  return document.querySelector("[data-bc-notice]")?.textContent ?? "";
}

function isVisible(): boolean {
  const el = document.querySelector<HTMLElement>("[data-bc-notice]");
  return el !== null && !el.hidden;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mountConnectionNotice", () => {
  it("mounts hidden, with role=status/aria-live so it never steals attention on load", () => {
    const notice = mount();
    expect(document.querySelector("[data-bc-notice]")?.hasAttribute("hidden")).toBe(true);
    const el = document.querySelector("[data-bc-notice]");
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.getAttribute("aria-live")).toBe("polite");
    notice.destroy();
  });

  it("carries data-bc-surface=connection-notice, the DOM allowlist tag (FR151)", () => {
    const notice = mount();
    expect(document.querySelector("[data-bc-notice]")?.getAttribute("data-bc-surface")).toBe(
      "connection-notice",
    );
    notice.destroy();
  });

  it("a connect error at boot shows the notice, after the debounce", () => {
    const notice = mount();
    notice.setStatus("disconnected");
    expect(isVisible()).toBe(false);
    vi.advanceTimersByTime(999);
    expect(isVisible()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isVisible()).toBe(true);
    expect(noticeText()).toBe("Connection lost — reconnecting…");
    notice.destroy();
  });

  it("a drop after a successful connect also shows the notice", () => {
    const notice = mount();
    notice.setStatus("connecting");
    notice.setStatus("connected");
    vi.advanceTimersByTime(10_000);
    expect(isVisible()).toBe(false);
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(1000);
    expect(isVisible()).toBe(true);
    notice.destroy();
  });

  it("a brief blip never flickers the notice on: reconnecting before the debounce elapses cancels it", () => {
    const notice = mount();
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(500);
    notice.setStatus("connected");
    vi.advanceTimersByTime(2000);
    expect(isVisible()).toBe(false);
    notice.destroy();
  });

  it("repeated drops or errors never create a second notice element", () => {
    const notice = mount();
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(1000);
    notice.setStatus("disconnected");
    notice.setStatus("disconnected");
    expect(document.querySelectorAll("[data-bc-notice]")).toHaveLength(1);
    notice.destroy();
  });

  it("this story does not implement reconnection: once shown, the notice stays up (no auto-hide, no internal timer clears it on its own)", () => {
    const notice = mount();
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(1000);
    expect(isVisible()).toBe(true);
    // Time passing alone never hides it -- only an explicit "connected".
    vi.advanceTimersByTime(60_000);
    expect(isVisible()).toBe(true);
    notice.destroy();
  });

  it("on recovery: shows 'Reconnected', holds, then fades and hides -- the fade is the only animation", () => {
    const notice = mount();
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(1000);
    expect(isVisible()).toBe(true);

    notice.setStatus("connected");
    expect(isVisible()).toBe(true);
    expect(noticeText()).toBe("Reconnected");
    expect(document.querySelector("[data-bc-notice]")?.getAttribute("data-bc-fading")).toBeNull();

    vi.advanceTimersByTime(1499);
    expect(isVisible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(document.querySelector("[data-bc-notice]")?.getAttribute("data-bc-fading")).toBe("true");
    expect(isVisible()).toBe(true);

    vi.advanceTimersByTime(299);
    expect(isVisible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isVisible()).toBe(false);
    notice.destroy();
  });

  it("a re-drop while showing 'Reconnected' or mid-fade re-shows immediately, with no fresh debounce", () => {
    const notice = mount();
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(1000);
    notice.setStatus("connected");
    // Still in the "Reconnected" hold window.
    notice.setStatus("disconnected");
    expect(isVisible()).toBe(true);
    expect(noticeText()).toBe("Connection lost — reconnecting…");
    notice.destroy();
  });

  it("never uses alert, confirm or prompt", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const notice = mount();
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(1000);
    notice.setStatus("connected");
    vi.advanceTimersByTime(2000);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
    notice.destroy();
  });

  it("never takes focus", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const notice = mount();
    notice.setStatus("disconnected");
    vi.advanceTimersByTime(1000);
    expect(document.activeElement).toBe(outside);
    notice.destroy();
  });

  it("destroy removes the element and clears its timers, so a stray timer never fires against a detached node", () => {
    const notice = mount();
    notice.setStatus("disconnected");
    notice.destroy();
    expect(document.querySelector("[data-bc-notice]")).toBeNull();
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it("inv_connection_notice_tracks_state", () => {
    // For any sequence of connect/disconnect/error events (modelled as
    // ConnectionStatus values), at most one notice element ever exists,
    // and -- once every pending timer has settled -- it is visible
    // exactly when the last status was not "connected". debounce/hold/
    // fade are all 0 here so "settled" needs no fake-timer bookkeeping
    // inside the property itself: every timer this module schedules
    // fires on the very next tick it is given.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<ConnectionStatus>("connecting", "connected", "disconnected"), {
          minLength: 0,
          maxLength: 30,
        }),
        (sequence) => {
          document.body.innerHTML = "";
          const notice = mount({ debounceMs: 0, recoveredHoldMs: 0, fadeMs: 0 });
          let last: ConnectionStatus | undefined;
          for (const status of sequence) {
            notice.setStatus(status);
            vi.runAllTimers();
            last = status;
          }
          expect(document.querySelectorAll("[data-bc-notice]")).toHaveLength(1);
          if (last !== undefined) {
            expect(isVisible()).toBe(last !== "connected");
          }
          notice.destroy();
        },
      ),
    );
  });
});

describe("ConnectionNoticeHandle", () => {
  it("element is the same node across the handle's lifetime", () => {
    let notice: ConnectionNoticeHandle | undefined;
    try {
      notice = mount();
      const first = notice.element;
      notice.setStatus("disconnected");
      vi.advanceTimersByTime(1000);
      expect(notice.element).toBe(first);
    } finally {
      notice?.destroy();
    }
  });
});
