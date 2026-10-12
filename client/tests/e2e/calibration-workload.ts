// The fixed, committed calibration workload shared by the two timing gates
// that normalise by it (`l3-budget.spec.ts`, `boot-budget/boot-budget.spec.ts`).
// Run inside a page, so it is slowed by exactly the CPU throttle that page
// runs under.

/** The fixed, committed calibration workload: pure JS (typed-array sort and
 * arithmetic, string-keyed map traffic), not L3 code, so it does not move with
 * what it calibrates. Run in the page; returns the median of `runs` in ms. It
 * is the denominator the regression tripwire divides by, so a slower runner
 * CPU does not read as L3 getting slower. */
export function calibrationWorkload(runs: number): number {
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    let acc = 0;
    const values = new Float64Array(4096);
    for (let rep = 0; rep < 12; rep++) {
      for (let i = 0; i < values.length; i++) values[i] = Math.sin(i * 12.9898 + rep) * 1e3;
      values.sort();
      for (let i = 0; i < values.length; i++) acc += Math.sqrt(Math.abs(values[i] as number));
    }
    const map = new Map<string, number>();
    for (let i = 0; i < 2048; i++) map.set(`key-${i % 512}-${i & 7}`, i);
    for (let i = 0; i < 2048; i++) acc += map.get(`key-${i % 512}-${i & 7}`) ?? 0;
    if (acc === -1) console.log(acc);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1] as number;
}
