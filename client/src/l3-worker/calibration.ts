// The fixed calibration workload the L3 budget gate divides by: pure JS
// (typed-array sort and arithmetic, string-keyed map traffic), not L3 code, so
// it does not move with what it calibrates. Run on the main thread and inside
// the worker with the same body, so a CPU throttle that reaches the worker
// shows as the same slowdown there.

/** The median of `runs` timed passes, in ms, by the caller's clock. */
export function calibrationWorkload(runs: number, now: () => number): number {
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const start = now();
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
    if (acc === -1) times.push(acc);
    times.push(now() - start);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1] as number;
}
