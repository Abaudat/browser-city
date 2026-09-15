// Story 1.14 (NFR1): the exact network/CPU profiles and the pre-registered
// budget docs/spikes/1.14-boot-budget.md measures against. One
// definition, imported by boot-budget.spec.ts (which drives CDP with it),
// scripts/dev/generate-boot-budget-report.mjs (which prints it in the
// report header) and reduce.test.ts (vitest) -- so the numbers a reader
// sees in the report are the numbers that were actually applied to the
// browser, never a second, drifted copy.
//
// Written and committed before any number in this story was read
// (Quentin's/Tim's direction): this file must never be edited to make a
// result look better after a run. A cycle addendum, with both results
// shown, is the only way a number here changes once samples exist.

// Tim fixed the domestic profile explicitly ("I fix it at"); Quentin's own
// assumption for the same profile used 20ms RTT instead of 30ms. Crew
// resolves the conflict in Tim's favour for the primary "domestic"
// profile (network stack specifics are squarely his call) and keeps
// Quentin's second, pessimistic profile as its own row rather than
// dropping it -- both leads asked for two network points, and the two
// numbers disagree by only 10ms on the one they share.
export const NETWORK_PROFILES = [
  {
    name: "domestic",
    label: "typical domestic (50 Mbps down / 10 Mbps up / 30 ms RTT)",
    downloadKbps: 50_000,
    uploadKbps: 10_000,
    latencyMs: 30,
  },
  {
    name: "pessimistic",
    label: "pessimistic (10 Mbps down / 10 Mbps up / 60 ms RTT)",
    downloadKbps: 10_000,
    uploadKbps: 10_000,
    latencyMs: 60,
  },
];

// Tim: "Reference machine: a real mid-range laptop, no CPU throttling" /
// "Throttled: CDP Emulation.setCPUThrottlingRate 4x. This is how the
// result gets reproduced on any machine, CI included." Quentin: "mid-range
// laptop = 4x CPU throttle on the CI runner, plus one run on a real
// developer machine recorded separately and labelled as such." Both
// converge on the same two points.
export const CPU_PROFILES = [
  { name: "reference", label: "reference machine, no CPU throttle", rate: 1 },
  { name: "throttled", label: "CDP 4x CPU throttle (reproducible anywhere, CI included)", rate: 4 },
];

/** Quentin's floor: "Minimum 20 cold samples per profile". */
export const MIN_SAMPLES = 20;

/** Tim's pre-registered budget (1000 ms total, reference machine,
 * median), written before the first run. */
export const PRE_REGISTERED_BUDGET_MS = Object.freeze({
  bundle: 250,
  defs: 50,
  atlas: 250,
  handshake: 150,
  subscriptionDecode: 150,
  toControllable: 150,
  total: 1000,
});

/** D4's sweep -- the ~28k-row street plus half/double it either side, so
 * the report shows a curve, not one point. */
export const DECODE_ROW_COUNTS = Object.freeze([7000, 14000, 28000, 56000]);

/** Tim's pre-registered D4 revisit trigger: "the 28k-row decode passes if
 * its throttled-profile p95 is <=150 ms. Anything above that opens D4's
 * chunking migration." */
export const DECODE_REVISIT_ROW_COUNT = 28000;
export const DECODE_REVISIT_TRIGGER_MS = 150;
export const DECODE_REVISIT_PROFILE = "throttled";
export const DECODE_REVISIT_PERCENTILE = "p95";
