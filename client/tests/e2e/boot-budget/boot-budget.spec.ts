// Story 1.14 (NFR1): the boot-budget harness. Its own Playwright project,
// `boot`, run only through `scripts/dev/run-boot-budget-spike.sh` (never
// `npm run test:e2e`) -- see playwright.config.ts for why. Every sample is
// a *fresh* browser context (cold means cold: no HTTP cache, no service
// worker, no storage), against the *production* build the script serves
// through `vite preview` -- never the dev server, which serves unbundled
// ESM and would measure the wrong thing entirely (Tim's direction).
//
// This file only ever *writes* raw per-sample JSON under BC_BOOT_OUT_DIR;
// it asserts nothing against the pre-registered budget (Quentin/Tim: the
// spike itself is not a PR gate). `scripts/dev/generate-boot-budget-
// report.mjs` is the only thing that reduces that raw JSON into
// docs/spikes/1.14-boot-budget.md's tables and its met/missed verdict.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type CDPSession, expect, test } from "@playwright/test";
import { BOOT_MARK } from "../../../src/boot/boot-marks";
import type {} from "./decode-harness";
import { CPU_PROFILES, DECODE_ROW_COUNTS, MIN_SAMPLES, NETWORK_PROFILES } from "./profiles.mjs";

interface NetworkProfile {
  readonly name: string;
  readonly label: string;
  readonly downloadKbps: number;
  readonly uploadKbps: number;
  readonly latencyMs: number;
}
interface CpuProfile {
  readonly name: string;
  readonly label: string;
  readonly rate: number;
}

interface RawResourceEntry {
  readonly name: string;
  readonly initiatorType: string;
  readonly fetchStart: number;
  readonly responseEnd: number;
  readonly transferSize: number;
}
interface RawSample {
  readonly marks: Record<string, number>;
  readonly firstPaintMs: number | null;
  readonly resources: readonly RawResourceEntry[];
}

const SAMPLES = Number(process.env.BC_BOOT_SAMPLES ?? MIN_SAMPLES);
const OUT_DIR = process.env.BC_BOOT_OUT_DIR ?? "test-results/story-1.14-boot-budget";
mkdirSync(OUT_DIR, { recursive: true });

// A cold-network, cold-CPU sweep contends for the same machine's own
// resources; running samples concurrently would make each one measure the
// others' throttling too. Never parallel, the same discipline
// street-perf.spec.ts's own serial config sets project-wide.
test.describe.configure({ mode: "serial" });

async function applyThrottling(
  cdp: CDPSession,
  network: NetworkProfile,
  cpu: CpuProfile,
): Promise<void> {
  await cdp.send("Network.enable");
  // Cold means cold (Quentin's direction): no HTTP cache surviving
  // between a "fresh context" and the next one on the same machine.
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: network.latencyMs,
    downloadThroughput: (network.downloadKbps * 1000) / 8,
    uploadThroughput: (network.uploadKbps * 1000) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu.rate });
}

/** Turns one page's raw marks/paint/resource-timing entries into the
 * named terms the report's attribution table reads -- Resource Timing for
 * fetch/decode, the boot marks for everything the browser cannot see on
 * its own (Tim's direction). Never computed in the page itself: this runs
 * in Node, over data already carried across the `page.evaluate` boundary,
 * so it is exactly as testable as `reduce.mjs` (fixed input, pure output)
 * even though it is not re-exported there -- it depends on `BOOT_MARK`'s
 * names, which belong with the marks, not with the generic reducer. */
function computeSampleTerms(raw: RawSample) {
  const marks = raw.marks;
  const mainStart = marks[BOOT_MARK.MAIN_START] ?? 0;
  const handshakeOpen = marks[BOOT_MARK.HANDSHAKE_OPEN] ?? mainStart;
  const subscriptionApplied = marks[BOOT_MARK.SUBSCRIPTION_APPLIED] ?? handshakeOpen;
  const atlasReady = marks[BOOT_MARK.ATLAS_READY] ?? mainStart;
  const playerControllable = marks[BOOT_MARK.PLAYER_CONTROLLABLE] ?? atlasReady;

  const defsResources = raw.resources.filter((r) => r.name.endsWith("/defs/defs.json"));
  const defsMs =
    defsResources.length > 0
      ? Math.max(...defsResources.map((r) => r.responseEnd - r.fetchStart))
      : 0;

  // There is no real atlas yet (Tim's direction): every image fetched
  // before the player is controllable stands in for it, with its own
  // request count and byte total recorded alongside the timing.
  const imageResources = raw.resources.filter(
    (r) => /\.(png|jpe?g|webp)$/i.test(r.name) && r.responseEnd <= playerControllable,
  );
  const atlasMs =
    imageResources.length > 0
      ? Math.max(...imageResources.map((r) => r.responseEnd)) -
        Math.min(...imageResources.map((r) => r.fetchStart))
      : 0;
  const atlasBytes = imageResources.reduce((sum, r) => sum + (r.transferSize ?? 0), 0);

  // Terms are each a self-contained wall-clock duration for their own
  // phase, not disjoint slices of the total: the handshake proceeds
  // concurrently with the defs/atlas fetch in the real boot sequence
  // today, so their sum can exceed the end-to-end total. The remainder
  // (computed by reduce.mjs's summarizeTerms, from this same data) shows
  // that plainly instead of forcing a false reconciliation.
  const terms = {
    bundle: mainStart,
    defs: defsMs,
    atlas: atlasMs,
    handshake: Math.max(0, handshakeOpen - mainStart),
    subscriptionDecode: Math.max(0, subscriptionApplied - handshakeOpen),
    toControllable: Math.max(0, playerControllable - Math.max(atlasReady, subscriptionApplied)),
  };

  return {
    totalMs: playerControllable,
    firstPaintMs: raw.firstPaintMs,
    interactivePromptMs: marks[BOOT_MARK.INTERACTIVE_PROMPT] ?? null,
    terms,
    atlasRequestCount: imageResources.length,
    atlasBytes,
  };
}

async function collectOneSample(
  browser: import("@playwright/test").Browser,
  network: NetworkProfile,
  cpu: CpuProfile,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await applyThrottling(cdp, network, cpu);

  await page.goto("/");
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );

  const raw = (await page.evaluate(() => {
    const marks = Object.fromEntries(
      performance.getEntriesByType("mark").map((e) => [e.name, e.startTime]),
    );
    const fcp = performance
      .getEntriesByType("paint")
      .find((e) => e.name === "first-contentful-paint");
    const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(
      (e) => ({
        name: e.name,
        initiatorType: e.initiatorType,
        fetchStart: e.fetchStart,
        responseEnd: e.responseEnd,
        transferSize: e.transferSize,
      }),
    );
    return { marks, firstPaintMs: fcp ? fcp.startTime : null, resources };
  })) as RawSample;

  await context.close();
  return computeSampleTerms(raw);
}

for (const network of NETWORK_PROFILES as readonly NetworkProfile[]) {
  for (const cpu of CPU_PROFILES as readonly CpuProfile[]) {
    test(`milestones -- ${network.name} network, ${cpu.name} CPU (n=${SAMPLES})`, async ({
      browser,
    }) => {
      test.setTimeout(SAMPLES * 30_000 + 60_000);

      const samples = [];
      for (let i = 0; i < SAMPLES; i++) {
        samples.push(await collectOneSample(browser, network, cpu));
      }

      const outFile = path.join(OUT_DIR, `milestones-${network.name}-${cpu.name}.json`);
      writeFileSync(
        outFile,
        `${JSON.stringify(
          {
            network: { name: network.name, label: network.label },
            cpu: { name: cpu.name, label: cpu.label },
            samples,
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      expect(samples.length).toBe(SAMPLES);
      for (const sample of samples) {
        expect(sample.totalMs).toBeGreaterThan(0);
        expect(sample.firstPaintMs).not.toBeNull();
      }
    });
  }
}

// --- D4's subscription-decode sweep ---------------------------------
//
// scripts/dev/run-boot-budget-spike.sh publishes server/spikes/boot_budget
// to its own disposable database and passes its coordinates here; running
// this file directly (without the script) skips the sweep rather than
// failing, so `npm run test:e2e:boot` alone still runs the milestone
// half.
const DECODE_URL = process.env.BC_BOOT_DECODE_URL;
const DECODE_SERVER_URL = process.env.BC_BOOT_DECODE_SERVER_URL;
const DECODE_DB_NAME = process.env.BC_BOOT_DECODE_DB_NAME;
const DECODE_SAMPLES = Number(process.env.BC_BOOT_DECODE_SAMPLES ?? MIN_SAMPLES);

function reseedDecodeDb(serverUrl: string, dbName: string, rowCount: number): void {
  const clear = spawnSync(
    "spacetime",
    ["call", "--no-config", "--server", serverUrl, "--yes", dbName, "clear"],
    { encoding: "utf-8" },
  );
  if (clear.status !== 0) {
    throw new Error(`reseedDecodeDb: 'clear' failed:\n${clear.stdout}\n${clear.stderr}`);
  }
  const seed = spawnSync(
    "spacetime",
    [
      "call",
      "--no-config",
      "--server",
      serverUrl,
      "--yes",
      dbName,
      "seed_rows",
      String(rowCount),
      "0",
    ],
    { encoding: "utf-8" },
  );
  if (seed.status !== 0) {
    throw new Error(`reseedDecodeDb: 'seed_rows' failed:\n${seed.stdout}\n${seed.stderr}`);
  }
}

if (DECODE_URL && DECODE_SERVER_URL && DECODE_DB_NAME) {
  const wsUri = DECODE_SERVER_URL.replace(/^http/, "ws");

  for (const rowCount of DECODE_ROW_COUNTS as readonly number[]) {
    test.describe(`decode -- ${rowCount} rows`, () => {
      test.beforeAll(() => {
        reseedDecodeDb(DECODE_SERVER_URL, DECODE_DB_NAME, rowCount);
      });

      for (const network of NETWORK_PROFILES as readonly NetworkProfile[]) {
        for (const cpu of CPU_PROFILES as readonly CpuProfile[]) {
          test(`${network.name} network, ${cpu.name} CPU (n=${DECODE_SAMPLES})`, async ({
            browser,
          }) => {
            test.setTimeout(DECODE_SAMPLES * 30_000 + 60_000);

            const samples: { decodeMs: number; rowCount: number; bytesOnWire: number }[] = [];
            for (let i = 0; i < DECODE_SAMPLES; i++) {
              const context = await browser.newContext();
              const page = await context.newPage();
              const cdp = await context.newCDPSession(page);
              await applyThrottling(cdp, network, cpu);

              // Resource Timing never carries WebSocket payload bytes
              // (confirmed empirically while building this harness: it
              // reports 0 every time) -- CDP's own frame events are the
              // only place the subscription's actual byte count on the
              // wire is observable.
              let bytesOnWire = 0;
              cdp.on("Network.webSocketFrameReceived", (event) => {
                const { payloadData, opcode } = event.response;
                bytesOnWire +=
                  opcode === 2 ? Buffer.byteLength(payloadData, "base64") : payloadData.length;
              });

              await page.goto(
                `${DECODE_URL}?uri=${encodeURIComponent(wsUri)}&db=${encodeURIComponent(DECODE_DB_NAME)}`,
              );
              await page.waitForFunction(
                () =>
                  window.__bootDecode?.appliedAtMs !== undefined ||
                  window.__bootDecode?.error !== undefined,
                undefined,
                { timeout: 30_000 },
              );
              const result = await page.evaluate(() => window.__bootDecode);
              await context.close();

              if (!result || result.error) {
                throw new Error(`decode harness error: ${result?.error ?? "no result"}`);
              }
              if (result.rowCount !== rowCount) {
                throw new Error(
                  `decode harness applied ${result.rowCount} rows, expected ${rowCount} -- the seed did not land before subscribe`,
                );
              }
              samples.push({
                decodeMs: (result.appliedAtMs as number) - (result.subscribeStartMs as number),
                rowCount: result.rowCount,
                bytesOnWire,
              });
            }

            const outFile = path.join(
              OUT_DIR,
              `decode-${rowCount}-${network.name}-${cpu.name}.json`,
            );
            writeFileSync(
              outFile,
              `${JSON.stringify(
                {
                  rowCount,
                  network: { name: network.name, label: network.label },
                  cpu: { name: cpu.name, label: cpu.label },
                  samples,
                },
                null,
                2,
              )}\n`,
              "utf-8",
            );

            expect(samples.length).toBe(DECODE_SAMPLES);
          });
        }
      }
    });
  }
} else {
  test.skip("decode sweep skipped -- BC_BOOT_DECODE_URL/BC_BOOT_DECODE_SERVER_URL/BC_BOOT_DECODE_DB_NAME not set (run via scripts/dev/run-boot-budget-spike.sh)", () => {});
}
