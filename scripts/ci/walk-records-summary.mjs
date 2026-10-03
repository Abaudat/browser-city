// Writes the walk records (`client/walk-records/walks.jsonl`) as markdown for
// `$GITHUB_STEP_SUMMARY`: one overall line first, then the worst walk per
// spec, test and segment. Exits non-zero when there are no records.
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error(`walk-records-summary: no records at ${file}`);
  process.exit(1);
}
const records = readFileSync(file, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
if (records.length === 0) {
  console.error("walk-records-summary: the record file is empty");
  process.exit(1);
}
const max = (xs) => xs.reduce((m, x) => (x > m ? x : m), Number.NEGATIVE_INFINITY);
const fmt = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "-" : Number(n).toFixed(3));
const nums = (f) => records.map(f).filter((n) => typeof n === "number");

const bound = max(nums((r) => r.boundSteps));
const gap = records.reduce(
  (m, r) => (r.gapCells !== null && r.gapCells > (m?.gapCells ?? -1) ? r : m),
  null,
);
console.log(
  `### Walks: ${records.length}; worst rest past threshold ${fmt(max(nums((r) => r.pastAtRestSteps)))} clamped steps (bound ${fmt(bound)}); ` +
    `worst frames moved after release ${max(nums((r) => r.movedAfterKeyupFrames))}; ` +
    `worst unwatched gap ${gap ? `${gap.gapFrames} frames / ${fmt(gap.gapCells)} cells (${gap.spec} / ${gap.label})` : "-"}; ` +
    `late events ${records.reduce((n, r) => n + r.lateEvents.length, 0)}\n`,
);

const worst = new Map();
for (const r of records) {
  const key = [r.spec, r.test, r.label].join("\u0000");
  const past = r.pastAtRestSteps ?? Number.NEGATIVE_INFINITY;
  const prev = worst.get(key);
  if (!prev || past > prev.past) worst.set(key, { r, past });
}
console.log(
  "| spec | test | segment | mode | past at rest (steps) | moved after release | max frame step | max frame ms | gap frames | gap cells | late events |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const { r } of [...worst.values()].sort((a, b) => b.past - a.past)) {
  console.log(
    `| ${r.spec} | ${r.test} | ${r.label} | ${r.mode} | ${fmt(r.pastAtRestSteps)} | ${r.movedAfterKeyupFrames} | ${fmt(r.maxFrameStepSteps)} | ${fmt(r.maxFrameIntervalMs)} | ${r.gapFrames ?? "-"} | ${fmt(r.gapCells)} | ${r.lateEvents.length} |`,
  );
}
