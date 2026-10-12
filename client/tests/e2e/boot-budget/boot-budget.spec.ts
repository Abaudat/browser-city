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
import { calibrationWorkload } from "../calibration-workload";
import { computeSampleTerms } from "./compute-terms.mjs";
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

async function collectOneSample(
  browser: import("@playwright/test").Browser,
  network: NetworkProfile,
  cpu: CpuProfile,
  typingMs = 0,
) {
  // Quentin's cycle-3 direction: the production preview negotiates HTTP/2
  // over a throwaway self-signed cert (BC_BOOT_HTTPS,
  // vite.config.ts) so this sweep measures the same protocol GitHub Pages
  // serves in production, not the preview server's default HTTP/1.1.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await applyThrottling(cdp, network, cpu);

  await page.goto("/");
  // Story 4.6: a first boot is the name prompt. The player "types" for
  // `typingMs` after first contentful paint and submits; the bundle, the
  // defs and the flat have been streaming behind it the whole time.
  await page.waitForFunction(
    () =>
      performance.getEntriesByType("paint").some((e) => e.name === "first-contentful-paint") &&
      document.querySelector('[data-bc-surface="name-prompt"] input') !== null,
    undefined,
    { timeout: 30_000 },
  );
  if (typingMs > 0) await page.waitForTimeout(typingMs);
  await page.locator('[data-bc-surface="name-prompt"] input').fill("Sam");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => performance.getEntriesByName("bc-boot:player-controllable").length > 0,
    undefined,
    { timeout: 30_000 },
  );

  const raw = await page.evaluate(() => {
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
        requestStart: e.requestStart,
        responseEnd: e.responseEnd,
        transferSize: e.transferSize,
        nextHopProtocol: e.nextHopProtocol,
      }),
    );
    const entryScriptUrl =
      document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? "";
    return { marks, firstPaintMs: fcp ? fcp.startTime : null, resources, entryScriptUrl };
  });

  await context.close();
  return computeSampleTerms(raw);
}

// --- Story 4.6's first-boot gate (NFR1 / FR145) ----------------------
//
// Pre-registered before any number was read: `name-submitted` ->
// `player-controllable`, production build over HTTP/2, cold context,
// `domestic` network, 4x CPU, the player taking `GATE_TYPING_MS` after first
// contentful paint to type a short name. The verdict is the p75 of
// `GATE_SAMPLES` samples against `GATE_BUDGET_MS`, and no single typed
// sample may reach it. A miss is fixed on the critical path -- never with a
// longer typing window, a looser bound or fewer samples.
//
// Arrival is optimistic (control opens at submit once the first frame
// exists), so with a 2000 ms typing window the typed leg measures about one
// frame, and boot could grow a long way before it tripped. The leg that
// really moves is the 0 ms one -- submit at first paint, nothing streamed
// yet -- so it is gated too, normalised the way `l3-budget.spec.ts` is: its
// p75 (of `GATE_ZERO_SAMPLES` samples) is divided by the median time of a
// fixed pure-JS calibration workload run in the same job under the same 4x
// CPU throttle, and the ratio is held to `ZERO_LEG_RATIO_RECORDED` +25%.
// The raw milliseconds swing about 30% across shared runners (1 145 to
// 1 501 ms on one boot path), the ratio is what can be ratcheted: lower the
// constant when recorded runs improve it, never raise it. It is set from the
// recorded gate artifacts of the run named beside it.
const GATE_TYPING_MS = 2000;
const GATE_BUDGET_MS = 1000;
const GATE_SAMPLES = Number(process.env.BC_BOOT_GATE_SAMPLES ?? 10);
const GATE_ZERO_SAMPLES = Number(process.env.BC_BOOT_GATE_ZERO_SAMPLES ?? 20);
/** p75 of the 0 ms leg over the calibration workload's median, recorded from
 * `boot-budget.yml` run 38279321515's three gate repeats (n=20 each, domestic,
 * 4x CPU): 58.3, 58.7 and 57.1 (p75 1 352, 1 362 and 1 303 ms over a
 * calibration of 23.2, 23.2 and 22.8 ms). The highest is the constant. */
const ZERO_LEG_RATIO_RECORDED = 58.7;
const RATCHET_SLACK = 1.25;
/** Records the artifact without gating the ratio (the recording runs that
 * set `ZERO_LEG_RATIO_RECORDED`). Never set in `ci.yml`. */
const GATE_RECORD = Boolean(process.env.BC_BOOT_GATE_RECORD);
const GATE_ONLY = Boolean(process.env.BC_BOOT_GATE_ONLY);

/** Nearest-rank percentile of `values` (ms). */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] as number;
}

if (GATE_ONLY || process.env.BC_BOOT_GATE) {
  test(`first boot gate: submit -> controllable p75 < ${GATE_BUDGET_MS} ms (domestic, 4x CPU, ${GATE_TYPING_MS} ms typing, n=${GATE_SAMPLES})`, async ({
    browser,
  }) => {
    test.setTimeout((GATE_SAMPLES + GATE_ZERO_SAMPLES) * 30_000 + 120_000);
    const network = (NETWORK_PROFILES as readonly NetworkProfile[]).find(
      (n) => n.name === "domestic",
    ) as NetworkProfile;
    const cpu = (CPU_PROFILES as readonly CpuProfile[]).find(
      (c) => c.name === "throttled",
    ) as CpuProfile;

    /** The calibration workload's median, in a page under this CPU throttle. */
    const calibrate = async (): Promise<number> => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu.rate });
      await page.goto("about:blank");
      const ms = await page.evaluate(calibrationWorkload, 21);
      await context.close();
      return ms;
    };
    const calibrationBefore = await calibrate();

    const gated: number[] = [];
    const atFirstPaint: number[] = [];
    for (let i = 0; i < GATE_SAMPLES; i++) {
      const typed = await collectOneSample(browser, network, cpu, GATE_TYPING_MS);
      gated.push(typed.submitToControllableMs as number);
    }
    for (let i = 0; i < GATE_ZERO_SAMPLES; i++) {
      const instant = await collectOneSample(browser, network, cpu, 0);
      atFirstPaint.push(instant.submitToControllableMs as number);
    }

    const calibrationAfter = await calibrate();
    const calibrationMs = (calibrationBefore + calibrationAfter) / 2;
    const zeroP75 = percentile(atFirstPaint, 75);

    const verdict = {
      budgetMs: GATE_BUDGET_MS,
      calibrationMs,
      calibrationBeforeMs: calibrationBefore,
      calibrationAfterMs: calibrationAfter,
      zeroLegSamples: GATE_ZERO_SAMPLES,
      zeroLegRatio: zeroP75 / calibrationMs,
      zeroLegRatioRecorded: ZERO_LEG_RATIO_RECORDED,
      typingMs: GATE_TYPING_MS,
      samples: GATE_SAMPLES,
      gatedSubmitToControllableMs: gated,
      gatedP75Ms: percentile(gated, 75),
      submitAtFirstPaintMs: atFirstPaint,
      submitAtFirstPaintP75Ms: percentile(atFirstPaint, 75),
    };
    writeFileSync(
      path.join(OUT_DIR, "first-boot-gate.json"),
      `${JSON.stringify(verdict, null, 2)}\n`,
      "utf-8",
    );
    expect(verdict.gatedP75Ms).toBeLessThan(GATE_BUDGET_MS);
    for (const sample of gated) expect(sample).toBeLessThan(GATE_BUDGET_MS);
    if (!GATE_RECORD) {
      expect(ZERO_LEG_RATIO_RECORDED, "no recorded ratio to hold the 0 ms leg to").toBeGreaterThan(
        0,
      );
      expect(
        verdict.zeroLegRatio,
        "submit at first paint got slower relative to the calibration workload: fix the critical path; lower the constant when recorded runs improve it, never raise it",
      ).toBeLessThanOrEqual(ZERO_LEG_RATIO_RECORDED * RATCHET_SLACK);
    }
  });
}

for (const network of GATE_ONLY ? [] : (NETWORK_PROFILES as readonly NetworkProfile[])) {
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

/** Tim's/Quentin's cycle-1 finding: `subscribe()` -> `onApplied` conflates
 * server query evaluation, network transfer and client decode/apply into
 * one number -- and the raw data showed it (throttling the *client* CPU
 * made the number *faster*, which a client-decode-bound cost cannot do).
 * This control leg applies neither network emulation nor (for `reference`
 * CPU) any CDP instrumentation beyond the bare minimum needed to read the
 * result -- no `webSocketFrameReceived` listener, no `Network.
 * emulateNetworkConditions` call at all -- so there is at least one
 * reading with zero CDP overhead of any kind (Tim's direction). Never
 * used for the milestone sweep -- domestic/pessimistic are the only two
 * network conditions NFR1 itself cares about. */
const NO_EMULATION_NETWORK_PROFILE: NetworkProfile = {
  name: "none",
  label: "no network emulation at all (control leg)",
  downloadKbps: 0,
  uploadKbps: 0,
  latencyMs: 0,
};

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

interface DecodeSample {
  decodeMs: number;
  rowCount: number;
  bytesOnWire: number;
  /** Tim's/Quentin's split, via CDP `Network.webSocketFrame{Sent,Received}`
   * timestamps -- present only on the throttled (`domestic`/`pessimistic`)
   * legs, which are the only ones instrumented with the frame listener. */
  serverMs?: number;
  transferMs?: number;
  clientMs?: number;
  /** How many WebSocket frames the subscription's response actually
   * arrived in. When this is 1, `transferMs` is definitionally 0 and
   * `serverMs` covers both server-side query time *and* wire transfer of
   * that one frame -- the report states this plainly rather than let a
   * reader assume `server` is a pure isolate at every row count. */
  responseFrameCount?: number;
}

async function collectOneDecodeSample(
  browser: import("@playwright/test").Browser,
  network: NetworkProfile,
  cpu: CpuProfile,
  decodeUrl: string,
  wsUri: string,
  dbName: string,
  rowCount: number,
  captureFrames: boolean,
): Promise<DecodeSample> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  const framesSent: number[] = [];
  const framesReceived: number[] = [];
  let bytesOnWire = 0;

  if (captureFrames) {
    await applyThrottling(cdp, network, cpu);
    cdp.on("Network.webSocketFrameSent", (event) => {
      framesSent.push(event.timestamp);
    });
    cdp.on("Network.webSocketFrameReceived", (event) => {
      framesReceived.push(event.timestamp);
      const { payloadData, opcode } = event.response;
      bytesOnWire += opcode === 2 ? Buffer.byteLength(payloadData, "base64") : payloadData.length;
    });
  } else {
    // The bare control leg (Tim's direction): CPU throttling only, if the
    // profile calls for it -- no Network.enable, no emulation, no frame
    // listener at all.
    if (cpu.rate !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu.rate });
  }

  await page.goto(`${decodeUrl}?uri=${encodeURIComponent(wsUri)}&db=${encodeURIComponent(dbName)}`);
  await page.waitForFunction(
    () =>
      window.__bootDecode?.appliedAtMs !== undefined || window.__bootDecode?.error !== undefined,
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
  const decodeMs = (result.appliedAtMs as number) - (result.subscribeStartMs as number);

  const sample: DecodeSample = { decodeMs, rowCount: result.rowCount, bytesOnWire };

  if (captureFrames) {
    // The last frame this page ever *sends* is the subscribe call itself
    // (the harness sends nothing else afterwards); every frame it
    // *receives* after that belongs to this subscription's response, not
    // to the connection handshake that preceded it. Frame timestamps are
    // CDP monotonic seconds -- compared only against each other, never
    // against a page-side performance.now() reading (different clock
    // epoch); `clientMs` below is a duration-of-durations, not a
    // cross-clock timestamp subtraction, so the epoch difference is not a
    // correctness problem (see the report's Method section).
    const subscribeSentTs = framesSent.at(-1);
    const responseFrames = framesReceived.filter(
      (t) => subscribeSentTs !== undefined && t > subscribeSentTs,
    );
    if (subscribeSentTs !== undefined && responseFrames.length > 0) {
      const firstResponseTs = Math.min(...responseFrames);
      const lastResponseTs = Math.max(...responseFrames);
      const serverMs = (firstResponseTs - subscribeSentTs) * 1000;
      const transferMs = (lastResponseTs - firstResponseTs) * 1000;
      sample.serverMs = serverMs;
      sample.transferMs = transferMs;
      sample.clientMs = Math.max(0, decodeMs - serverMs - transferMs);
      sample.responseFrameCount = responseFrames.length;
    }
  }

  return sample;
}

if (DECODE_URL && DECODE_SERVER_URL && DECODE_DB_NAME) {
  const wsUri = DECODE_SERVER_URL.replace(/^http/, "ws");

  // `ci.yml`'s `boot-smoke` job proves the harness runs end to end on the
  // runner in a few minutes, not that it reproduces this story's own
  // numbers -- one row count is enough for that.
  const smokeRowCount = process.env.BC_BOOT_DECODE_ROW_COUNT
    ? Number(process.env.BC_BOOT_DECODE_ROW_COUNT)
    : undefined;
  const rowCountsToRun = smokeRowCount ? [smokeRowCount] : (DECODE_ROW_COUNTS as readonly number[]);

  for (const rowCount of rowCountsToRun) {
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

            const samples: DecodeSample[] = [];
            for (let i = 0; i < DECODE_SAMPLES; i++) {
              samples.push(
                await collectOneDecodeSample(
                  browser,
                  network,
                  cpu,
                  DECODE_URL,
                  wsUri,
                  DECODE_DB_NAME,
                  rowCount,
                  true,
                ),
              );
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

      // The control leg: no network emulation at all, both CPU profiles
      // (Quentin's direction), and no frame listener on `reference` CPU
      // specifically (Tim's direction: at least one reading with zero CDP
      // instrumentation).
      for (const cpu of CPU_PROFILES as readonly CpuProfile[]) {
        test(`${NO_EMULATION_NETWORK_PROFILE.name} network, ${cpu.name} CPU (n=${DECODE_SAMPLES}) [control]`, async ({
          browser,
        }) => {
          test.setTimeout(DECODE_SAMPLES * 30_000 + 60_000);

          const captureFrames = cpu.name !== "reference";
          const samples: DecodeSample[] = [];
          for (let i = 0; i < DECODE_SAMPLES; i++) {
            samples.push(
              await collectOneDecodeSample(
                browser,
                NO_EMULATION_NETWORK_PROFILE,
                cpu,
                DECODE_URL,
                wsUri,
                DECODE_DB_NAME,
                rowCount,
                captureFrames,
              ),
            );
          }

          const outFile = path.join(
            OUT_DIR,
            `decode-${rowCount}-${NO_EMULATION_NETWORK_PROFILE.name}-${cpu.name}.json`,
          );
          writeFileSync(
            outFile,
            `${JSON.stringify(
              {
                rowCount,
                network: {
                  name: NO_EMULATION_NETWORK_PROFILE.name,
                  label: NO_EMULATION_NETWORK_PROFILE.label,
                },
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
    });
  }
} else {
  test.skip("decode sweep skipped -- BC_BOOT_DECODE_URL/BC_BOOT_DECODE_SERVER_URL/BC_BOOT_DECODE_DB_NAME not set (run via scripts/dev/run-boot-budget-spike.sh)", () => {});
}
