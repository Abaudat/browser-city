// Writes the worst overshoot per helper mode and segment from the e2e walk
// records (`client/walk-records/walks.jsonl`) as a markdown table, for
// `$GITHUB_STEP_SUMMARY`. Reads the file named by the first argument.
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.log("No walk records.");
  process.exit(0);
}
const worst = new Map();
let walks = 0;
for (const line of readFileSync(file, "utf-8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  walks++;
  const key = `${r.mode}\u0000${r.label}`;
  const prev = worst.get(key);
  const past = r.pastAtRestSteps ?? Number.NEGATIVE_INFINITY;
  if (!prev || past > prev.past) worst.set(key, { r, past });
}
const fmt = (n) => (n === null || n === undefined ? "-" : Number(n).toFixed(3));
const rows = [...worst.values()].sort((a, b) => b.past - a.past);
console.log(`### Walk overshoot (${walks} walks)\n`);
console.log("| mode | segment | past at rest (steps) | past at rest (cells) | frames met to rest | keydown frame | max frame step | max frame ms | late events |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const { r } of rows) {
  const restFrames = r.restFrame !== null && r.metFrame !== null ? r.restFrame - r.metFrame : "-";
  console.log(
    `| ${r.mode} | ${r.label} | ${fmt(r.pastAtRestSteps)} | ${fmt(r.pastAtRestCells)} | ${restFrames} | ${r.keydownFrame ?? "-"} | ${fmt(r.maxFrameStepSteps)} | ${fmt(r.maxFrameIntervalMs)} | ${r.lateEvents.length} |`,
  );
}
