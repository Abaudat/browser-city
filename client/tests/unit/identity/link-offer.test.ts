import { describe, expect, it } from "vitest";
import {
  carrierDefId,
  type OfferInputs,
  offerDue,
  readOfferRules,
} from "../../../src/identity/link-offer";

const MIN_PER_DAY = 24 * 60;
const REAL_MS_PER_MIN = 2500;
const DAY_MICROS = BigInt(MIN_PER_DAY * REAL_MS_PER_MIN) * 1000n;

const base: OfferInputs = {
  character: { characterId: 1n, createdAtMicros: 5n * DAY_MICROS, linked: false },
  identity: { identityHex: "ab", persisted: true },
  configured: true,
  clock: { epochMicros: 0n, speed: 1 },
  realMsPerCityMinute: REAL_MS_PER_MIN,
  today: 6,
  lastShownDay: null,
  rules: { minCharacterAgeDays: 1, cooloffDays: 7 },
};

describe("offerDue (story 4.5, FR143)", () => {
  it("is due for a persisted, unlinked character a city day old", () => {
    expect(offerDue(base)).toBe(true);
  });

  it("is not due the day the character was created", () => {
    expect(offerDue({ ...base, today: 5 })).toBe(false);
  });

  it("is not due without a character, an identity report, a clock or today", () => {
    expect(offerDue({ ...base, character: null })).toBe(false);
    expect(offerDue({ ...base, identity: null })).toBe(false);
    expect(offerDue({ ...base, clock: null })).toBe(false);
    expect(offerDue({ ...base, today: undefined })).toBe(false);
  });

  it("is not due for an unpersisted identity, a linked character, or with no provider", () => {
    expect(offerDue({ ...base, identity: { identityHex: "ab", persisted: false } })).toBe(false);
    expect(
      offerDue({
        ...base,
        character: { characterId: 1n, createdAtMicros: 5n * DAY_MICROS, linked: true },
      }),
    ).toBe(false);
    expect(offerDue({ ...base, configured: false })).toBe(false);
  });

  it("respects the cool-off after the offer was shown", () => {
    expect(offerDue({ ...base, today: 10, lastShownDay: 6 })).toBe(false);
    expect(offerDue({ ...base, today: 13, lastShownDay: 6 })).toBe(true);
  });
});

describe("carrierDefId", () => {
  const defs = {
    tags: [
      { id: 3, key: "other" },
      { id: 34, key: "registry_post" },
    ],
    objects: [
      { id: 1, tags: [3] },
      { id: 18, tags: [3, 34] },
    ],
  };

  it("finds the object carrying the carrier tag, by tag", () => {
    expect(carrierDefId(defs as never)).toBe(18);
  });

  it("is undefined when the tag or an object carrying it is absent", () => {
    expect(carrierDefId({ ...defs, objects: [{ id: 1, tags: [3] }] } as never)).toBeUndefined();
    expect(carrierDefId({ ...defs, tags: [] } as never)).toBeUndefined();
  });
});

describe("readOfferRules", () => {
  it("reads the two identity balance keys", () => {
    const defs = {
      balance: [
        { key: "identity.link_prompt_min_character_age_days", value: 2 },
        { key: "identity.link_prompt_cooloff_days", value: 9 },
      ],
    };
    expect(readOfferRules(defs as never)).toEqual({ minCharacterAgeDays: 2, cooloffDays: 9 });
  });

  it("throws on a missing key, like every other balance read", () => {
    expect(() => readOfferRules({ balance: [] } as never)).toThrow(/link_prompt/);
  });
});
