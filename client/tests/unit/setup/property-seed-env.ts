import fc from "fast-check";

/** The seed from `FAST_CHECK_SEED`; `undefined` only when unset outside CI. */
export function parseFastCheckSeed(env: Record<string, string | undefined>): number | undefined {
  const raw = env.FAST_CHECK_SEED;
  if (raw === undefined) {
    if (env.CI) throw new Error("FAST_CHECK_SEED is unset under CI: every property run is seeded");
    return undefined;
  }
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(
      `FAST_CHECK_SEED must be a non-negative safe integer, got ${JSON.stringify(raw)}`,
    );
  }
  return Number(raw);
}

export function reproduceLine(seed: number, file: string): string {
  return `reproduce: FAST_CHECK_SEED=${seed >>> 0} npx vitest run ${file}`;
}

/** Throws the default report plus the reproduce line; silent on a green run. */
export function reportFailure(
  out: fc.RunDetails<unknown>,
  state: { testPath?: string },
  cwd: string,
): void {
  if (!out.failed) return;
  const norm = (p: string): string => p.split("\\").join("/");
  const prefix = `${norm(cwd)}/`;
  const path = norm(state.testPath ?? "<test file>");
  const file = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  throw new Error(`${fc.defaultReportMessage(out)}\n\n${reproduceLine(out.seed, file)}`, {
    cause: out.errorInstance,
  });
}
