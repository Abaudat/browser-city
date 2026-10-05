// Vitest reporter: writes every test's duration and effective timeout to
// `.vitest-durations.json` (gitignored) for scripts/ci/check-unit-test-durations.sh
// (NFR49). It only reports; the script decides. It never reads test sources.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestCase, TestModule, Vitest } from "vitest/node";

export interface DurationEntry {
  file: string;
  name: string;
  /** `null` when vitest measured none: the guard fails on it, never reads it as fast. */
  durationMs: number | null;
  timeoutMs: number;
  /** Resolved `retry` and `repeats` (0 when unset): a re-run must never decide a verdict. */
  retry: number;
  repeats: number;
  state: string;
}

export interface DurationReport {
  defaultTimeoutMs: number;
  tests: DurationEntry[];
}

function retryCount(retry: unknown): number {
  if (typeof retry === "number") return retry;
  if (retry && typeof retry === "object") {
    const count = (retry as { count?: unknown }).count;
    return typeof count === "number" ? count : 1;
  }
  return 0;
}

/** One entry per test that ran. `timeoutMs` is the test's resolved timeout
 * (a describe-level or per-test `{ timeout }` included), else the default. */
export function buildReport(
  modules: ReadonlyArray<Pick<TestModule, "moduleId" | "children">>,
  defaultTimeoutMs: number,
  root: string,
): DurationReport {
  const tests: DurationEntry[] = [];
  for (const mod of modules) {
    const id = mod.moduleId.split("\\").join("/");
    const base = root.split("\\").join("/");
    const file = id.startsWith(base) ? id.slice(base.length).replace(/^\/+/, "") : id;
    for (const t of mod.children.allTests() as Iterable<TestCase>) {
      const state = t.result().state;
      if (state === "skipped" || state === "pending") continue;
      const duration = t.diagnostic()?.duration;
      tests.push({
        file,
        name: t.fullName,
        durationMs: duration === undefined ? null : Math.round(duration * 100) / 100,
        timeoutMs: t.options.timeout ?? defaultTimeoutMs,
        retry: retryCount(t.options.retry),
        repeats: t.options.repeats ?? 0,
        state,
      });
    }
  }
  return { defaultTimeoutMs, tests };
}

export default class DurationReporter {
  private ctx!: Vitest;
  onInit(ctx: Vitest): void {
    this.ctx = ctx;
  }
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const root = this.ctx.config.root;
    const report = buildReport(modules, this.ctx.config.testTimeout, root);
    writeFileSync(join(root, ".vitest-durations.json"), JSON.stringify(report, null, 1));
  }
}
