// Story 1.14 (NFR1), cycle 2: fixed-input tests for the attribution logic
// (Quentin's direction: this is exactly where the early-ATLAS_READY bug
// happened, and it needs the same bar reduce.mjs already has).
import { describe, expect, it } from "vitest";
import { computeSampleTerms } from "../../e2e/boot-budget/compute-terms.mjs";

const ENTRY_URL = "http://127.0.0.1/assets/index-abc123.js";

interface RawOverrides {
  marks?: Record<string, number>;
  resources?: Array<{
    name: string;
    initiatorType: string;
    fetchStart: number;
    requestStart: number;
    responseEnd: number;
    transferSize: number;
    nextHopProtocol: string;
  }>;
}

function baseRaw(overrides: RawOverrides = {}) {
  return {
    marks: {
      "bc-boot:main-start": 100,
      "bc-boot:handshake-open": 150,
      "bc-boot:subscription-applied": 200,
      "bc-boot:atlas-ready": 500,
      "bc-boot:interactive-prompt": 520,
      "bc-boot:player-controllable": 520,
      ...overrides.marks,
    } as Record<string, number>,
    firstPaintMs: 60,
    entryScriptUrl: ENTRY_URL,
    resources: [
      {
        name: ENTRY_URL,
        initiatorType: "script",
        fetchStart: 10,
        requestStart: 12,
        responseEnd: 80,
        transferSize: 140000,
        nextHopProtocol: "h2",
      },
      {
        name: "http://127.0.0.1/defs/defs.json",
        initiatorType: "fetch",
        fetchStart: 105,
        requestStart: 106,
        responseEnd: 130,
        transferSize: 2000,
        nextHopProtocol: "h2",
      },
      {
        name: "http://127.0.0.1/assets/sheet-a.png",
        initiatorType: "img",
        fetchStart: 130,
        requestStart: 132,
        responseEnd: 300,
        transferSize: 20000,
        nextHopProtocol: "h2",
      },
      {
        name: "http://127.0.0.1/assets/sheet-b.png",
        initiatorType: "img",
        fetchStart: 200,
        requestStart: 260,
        responseEnd: 480,
        transferSize: 15000,
        nextHopProtocol: "h2",
      },
      ...(overrides.resources ?? []),
    ],
  };
}

describe("computeSampleTerms", () => {
  it("attributes bundle from the entry script's own Resource Timing, never mainStart", () => {
    const result = computeSampleTerms(baseRaw());
    // responseEnd(80) - fetchStart(10) = 70, not mainStart (100)
    expect(result.terms.bundle).toBe(70);
    // mainStart(100) - responseEnd(80) = 20, the module-evaluation gap
    expect(result.terms.eval).toBe(20);
  });

  it("splits atlas into fetch-only and fetch-to-decoded", () => {
    const result = computeSampleTerms(baseRaw());
    // atlasFetch: max(responseEnd)=480 - min(fetchStart)=130 = 350
    expect(result.terms.atlasFetch).toBe(350);
    // atlasDecoded: ATLAS_READY(500) - min(fetchStart)=130 = 370
    expect(result.terms.atlasDecoded).toBe(370);
  });

  it("records atlas request count, bytes, protocol mix and median queuing delay", () => {
    const result = computeSampleTerms(baseRaw());
    expect(result.atlasRequestCount).toBe(2);
    expect(result.atlasBytes).toBe(35000);
    expect(result.atlasProtocolCounts).toEqual({ h2: 2 });
    // queuing: sheet-a = 132-130=2, sheet-b = 260-200=60; median of [2,60] = 31
    expect(result.atlasMedianQueuingMs).toBe(31);
  });

  it("excludes an image resource that finishes after player-controllable", () => {
    const raw = baseRaw({
      resources: [
        {
          name: "http://127.0.0.1/assets/late-sheet.png",
          initiatorType: "img",
          fetchStart: 510,
          requestStart: 511,
          responseEnd: 900, // after player-controllable (520)
          transferSize: 99999,
          nextHopProtocol: "h2",
        },
      ],
    });
    const result = computeSampleTerms(raw);
    expect(result.atlasRequestCount).toBe(2); // the late one is excluded
    expect(result.atlasBytes).toBe(35000);
  });

  it("throws when an in-scope image resource did not negotiate HTTP/2", () => {
    const raw = baseRaw({
      resources: [
        {
          name: "http://127.0.0.1/assets/sheet-c.png",
          initiatorType: "img",
          fetchStart: 130,
          requestStart: 132,
          responseEnd: 300,
          transferSize: 20000,
          nextHopProtocol: "http/1.1",
        },
      ],
    });
    expect(() => computeSampleTerms(raw)).toThrow(/did not negotiate|not 'h2'/);
  });

  it("computes handshake, subscriptionDecode and toControllable from the marks", () => {
    const result = computeSampleTerms(baseRaw());
    expect(result.terms.handshake).toBe(50); // 150 - 100
    expect(result.terms.subscriptionDecode).toBe(50); // 200 - 150
    expect(result.terms.toControllable).toBe(20); // 520 - max(500, 200)
  });

  it("reports totalMs, firstPaintMs, interactivePromptMs and playerControllableMs", () => {
    const result = computeSampleTerms(baseRaw());
    expect(result.totalMs).toBe(520);
    expect(result.firstPaintMs).toBe(60);
    expect(result.interactivePromptMs).toBe(520);
    expect(result.playerControllableMs).toBe(520);
  });

  it("throws, never silently defaults to 0, when a required mark is missing", () => {
    const raw = baseRaw();
    delete raw.marks["bc-boot:atlas-ready"];
    expect(() => computeSampleTerms(raw)).toThrow(/missing required boot mark/);
  });

  it("throws for each of the required marks in turn", () => {
    const names = [
      "bc-boot:main-start",
      "bc-boot:handshake-open",
      "bc-boot:subscription-applied",
      "bc-boot:atlas-ready",
      "bc-boot:interactive-prompt",
      "bc-boot:player-controllable",
    ];
    for (const name of names) {
      const raw = baseRaw();
      delete raw.marks[name];
      expect(() => computeSampleTerms(raw), name).toThrow(/missing required boot mark/);
    }
  });

  it("throws when entryScriptUrl has no matching Resource Timing entry", () => {
    const raw = baseRaw();
    raw.entryScriptUrl = "http://127.0.0.1/assets/does-not-exist.js";
    expect(() => computeSampleTerms(raw)).toThrow(/no Resource Timing entry/);
  });

  it("throws when entryScriptUrl is missing entirely", () => {
    const raw = baseRaw();
    raw.entryScriptUrl = "";
    expect(() => computeSampleTerms(raw)).toThrow(/entryScriptUrl is required/);
  });
});
