// Story 1.14 (NFR1): markBoot is a thin, permanent wrapper over the real
// `performance.mark` -- these tests exist so a rename of one of
// BOOT_MARK's string values (which docs/spikes/1.14-boot-budget.md's
// harness reads by exact name) is a red test, not a silent drift.
import { describe, expect, it, vi } from "vitest";
import { BOOT_MARK, markBoot } from "../../../src/boot/boot-marks";

describe("BOOT_MARK", () => {
  it("names every milestone with the bc-boot: prefix and no duplicate values", () => {
    const values = Object.values(BOOT_MARK);
    for (const name of values) {
      expect(name.startsWith("bc-boot:")).toBe(true);
    }
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("markBoot", () => {
  it("calls the real performance.mark with the given name, and nothing else", () => {
    const markSpy = vi.spyOn(performance, "mark").mockImplementation(() => ({}) as PerformanceMark);

    markBoot(BOOT_MARK.MAIN_START);

    expect(markSpy).toHaveBeenCalledExactlyOnceWith("bc-boot:main-start");

    markSpy.mockRestore();
  });
});
