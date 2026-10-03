import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isLinkPromptDue,
  LINK_PROMPT_STORAGE_KEY,
  type LinkPromptInputs,
  type LinkPromptRules,
  loadLastShownDay,
  saveLastShownDay,
} from "../../../src/identity/link-prompt";
import type { SettingsStorage } from "../../../src/settings/settings-storage";
import { sizeProbe } from "../setup/size-probe";

const RULES: LinkPromptRules = { minCharacterAgeDays: 1, cooloffDays: 7 };

const due: LinkPromptInputs = {
  hasCharacter: true,
  linked: false,
  tokenPersisted: true,
  issuerConfigured: true,
  characterCreatedDay: 10,
  today: 11,
  lastShownDay: null,
};

describe("isLinkPromptDue (story 4.5, FR143)", () => {
  it("is due for an unlinked, persisted character past its minimum age, never shown", () => {
    expect(isLinkPromptDue(due, RULES)).toBe(true);
  });

  it("needs a character", () => {
    expect(isLinkPromptDue({ ...due, hasCharacter: false }, RULES)).toBe(false);
  });

  it("never prompts once linked", () => {
    expect(isLinkPromptDue({ ...due, linked: true }, RULES)).toBe(false);
  });

  it("never prompts when the token could not be persisted, or no issuer is configured", () => {
    expect(isLinkPromptDue({ ...due, tokenPersisted: false }, RULES)).toBe(false);
    expect(isLinkPromptDue({ ...due, issuerConfigured: false }, RULES)).toBe(false);
  });

  it("waits out the character's minimum age: due on the day it is reached, not the day before", () => {
    expect(isLinkPromptDue({ ...due, characterCreatedDay: 10, today: 10 }, RULES)).toBe(false);
    expect(isLinkPromptDue({ ...due, characterCreatedDay: 10, today: 11 }, RULES)).toBe(true);
  });

  it("does not repeat before the cool-off, and is due again on the day it ends", () => {
    expect(isLinkPromptDue({ ...due, today: 20, lastShownDay: 14 }, RULES)).toBe(false);
    expect(isLinkPromptDue({ ...due, today: 21, lastShownDay: 14 }, RULES)).toBe(true);
  });

  it("a clock that reads before the last shown day does not prompt", () => {
    expect(isLinkPromptDue({ ...due, today: 3, lastShownDay: 14 }, RULES)).toBe(false);
  });

  // Once shown it is not due again before its cool-off, and once linked it is never due.
  it("inv_link_prompt_respects_cooloff_and_link", () => {
    const probe = sizeProbe();
    fc.assert(
      fc.property(
        fc.record({
          hasCharacter: fc.boolean(),
          tokenPersisted: fc.boolean(),
          issuerConfigured: fc.boolean(),
          characterCreatedDay: fc.integer({ min: -50, max: 400 }),
          shownDay: fc.integer({ min: -50, max: 400 }),
          cooloffDays: fc.integer({ min: 1, max: 365 }),
          minCharacterAgeDays: fc.integer({ min: 0, max: 365 }),
          later: probe.over(
            fc.array(fc.integer({ min: -50, max: 800 }), { maxLength: 12 }),
            (a) => a.length,
          ),
        }),
        (r) => {
          const rules = {
            minCharacterAgeDays: r.minCharacterAgeDays,
            cooloffDays: r.cooloffDays,
          };
          for (const today of r.later) {
            const base: LinkPromptInputs = {
              hasCharacter: r.hasCharacter,
              linked: false,
              tokenPersisted: r.tokenPersisted,
              issuerConfigured: r.issuerConfigured,
              characterCreatedDay: r.characterCreatedDay,
              today,
              lastShownDay: r.shownDay,
            };
            if (today < r.shownDay + r.cooloffDays) {
              expect(isLinkPromptDue(base, rules)).toBe(false);
            }
            expect(isLinkPromptDue({ ...base, linked: true }, rules)).toBe(false);
            expect(isLinkPromptDue({ ...base, linked: true, lastShownDay: null }, rules)).toBe(
              false,
            );
          }
        },
      ),
    );
    probe.expectReached(10);
  });
});

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: SettingsStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
  return { storage, data };
}

describe("the last shown day (bc.link-prompt.v1)", () => {
  it("round-trips", () => {
    const f = fakeStorage();
    expect(loadLastShownDay(f.storage)).toBeNull();
    expect(saveLastShownDay(f.storage, 12)).toBe(true);
    expect(loadLastShownDay(f.storage)).toBe(12);
    expect([...f.data.keys()]).toEqual([LINK_PROMPT_STORAGE_KEY]);
  });

  it("reads null for anything unusable and never throws", () => {
    for (const raw of ["", "{", "null", '{"version":1,"day":"x"}', '{"version":1,"day":1.5}']) {
      expect(loadLastShownDay(fakeStorage({ [LINK_PROMPT_STORAGE_KEY]: raw }).storage)).toBeNull();
    }
    expect(loadLastShownDay(null)).toBeNull();
  });

  it("a write that fails is reported, not thrown", () => {
    const failing: SettingsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(saveLastShownDay(failing, 3)).toBe(false);
  });
});
