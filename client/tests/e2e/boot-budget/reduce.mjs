// Story 1.14 (NFR1): pure reduction over raw per-sample milestone
// readings -- percentiles, per-term attribution and the unattributed
// remainder. Never fed a browser, a clock or a file handle directly, so
// it is exactly as testable as sched_timing_report's Rust binary was
// (Quentin's direction: "the report reducer ... gets vitest tests with
// fixed inputs"). scripts/dev/generate-boot-budget-report.mjs is the only
// thing that turns this module's output into docs/spikes/1.14-boot-
// budget.md's tables -- by calling these functions, never by hand.

/** The value at percentile `p` (0-100) of an ascending-sorted array,
 * nearest-rank (never interpolated) -- the same convention
 * street-perf.spec.ts's own `percentile` uses. */
export function percentileOfSorted(sortedAscending, p) {
  if (sortedAscending.length === 0) return Number.NaN;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.floor((p / 100) * sortedAscending.length),
  );
  return sortedAscending[index];
}

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return percentileOfSorted(sorted, p);
}

export function median(values) {
  return percentile(values, 50);
}

/** n, median, p75, p95 and max over one array of samples -- never a
 * single run, never the mean alone (Quentin's direction). */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    median: percentileOfSorted(sorted, 50),
    p75: percentileOfSorted(sorted, 75),
    p95: percentileOfSorted(sorted, 95),
    max: sorted.length > 0 ? sorted[sorted.length - 1] : Number.NaN,
  };
}

/** `summarize` over every named term in an array of per-sample term maps
 * (`{bundle, defs, atlas, ...}` -> ms), plus the same over `totalMs` and
 * over the unattributed remainder (`totalMs - sum(terms)`) -- shown
 * explicitly, per sample, rather than hidden (Quentin's direction). A
 * negative remainder is not an error: terms that run concurrently in the
 * real boot sequence (e.g. the handshake alongside the defs/atlas fetch)
 * can sum to more than the end-to-end total. */
export function summarizeTerms(samples) {
  const termNames = Object.keys(samples[0]?.terms ?? {});
  /** @type {Record<string, ReturnType<typeof summarize>>} */
  const perTerm = {};
  for (const name of termNames) {
    perTerm[name] = summarize(samples.map((s) => s.terms[name]));
  }
  const totals = summarize(samples.map((s) => s.totalMs));
  const remainders = summarize(
    samples.map((s) => s.totalMs - termNames.reduce((sum, name) => sum + s.terms[name], 0)),
  );
  return { n: samples.length, terms: perTerm, total: totals, remainder: remainders };
}

/** Tim's pre-registered verdict rule: p75 (this report's own choice --
 * Tim's budget is stated as a median target, Quentin's floor asks for
 * p75/p95 reporting; the verdict itself is read on p75, the stricter of
 * the two central tendencies, so a bar barely met on the exact median
 * never gets called "met") against the pre-registered total. */
export function verdictMet(termsSummary, budgetTotalMs) {
  return termsSummary.total.p75 <= budgetTotalMs;
}

/** Tim's pre-registered D4 revisit trigger: the named row count's p95
 * decode time, on the named profile, against the trigger ms. */
export function decodeRevisitOpened(decodeSummaryP95Ms, triggerMs) {
  return decodeSummaryP95Ms > triggerMs;
}
