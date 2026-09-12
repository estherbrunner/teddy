// Coverage signals (adr/0006 adapter): reads the istanbul json-summary that
// vitest, jest, and c8 all emit (coverage/coverage-summary.json) and, when
// coverage/lcov.info is present, computes line coverage over the lines this
// branch changed against its merge base with main. Emits signals only —
// never a gate verdict beyond pass/skip; thresholds live in the rubric.
//   total          fraction of lines covered, whole project
//   changed_lines  fraction of changed (added) lines covered — omitted when
//                  lcov.info or the merge base is unavailable
// Usage: node checks/coverage.ts [--json] [root]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { emitResult } from "./lib.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const log = (msg: string): void => (json ? console.error(msg) : console.log(msg));

const summaryPath = join(root, "coverage", "coverage-summary.json");
if (!existsSync(summaryPath)) {
  log("coverage: coverage/coverage-summary.json not found — run the test runner with coverage first; skipped");
  emitResult("coverage", "skip", json);
}

const signals: Record<string, number> = {};
try {
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
    total?: { lines?: { pct?: number } };
  };
  const pct = summary.total?.lines?.pct;
  if (typeof pct !== "number") throw new Error("total.lines.pct missing");
  signals.total = Math.round(pct * 100) / 10000;
} catch (e) {
  console.error(`FAIL: coverage: cannot read coverage-summary.json: ${(e as Error).message}`);
  emitResult("coverage", "fail", json);
}

// Changed-lines coverage: added lines of the branch ∩ lcov DA records.
const lcovPath = join(root, "coverage", "lcov.info");
const base = spawnSync("git", ["-C", root, "merge-base", "main", "HEAD"], { encoding: "utf8" });
if (existsSync(lcovPath) && base.status === 0) {
  const diff = spawnSync("git", ["-C", root, "diff", "--unified=0", `${base.stdout.trim()}..HEAD`], {
    encoding: "utf8",
  }).stdout;
  const added = new Map<string, Set<number>>(); // file → added line numbers
  let file = "";
  for (const line of diff.split("\n")) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) {
      file = f[1];
      continue;
    }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      const set = added.get(file) ?? new Set<number>();
      for (let n = start; n < start + count; n++) set.add(n);
      added.set(file, set);
    }
  }
  let hit = 0;
  let total = 0;
  let sf = "";
  for (const line of readFileSync(lcovPath, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      const abs = line.slice(3).trim();
      sf = abs.startsWith("/") ? relative(root, abs) : abs;
      continue;
    }
    const da = line.match(/^DA:(\d+),(\d+)/);
    if (da && added.get(sf)?.has(Number(da[1]))) {
      total++;
      if (Number(da[2]) > 0) hit++;
    }
  }
  if (total > 0) signals.changed_lines = Math.round((hit / total) * 10000) / 10000;
  else log("coverage: no changed lines are instrumented — changed_lines omitted");
} else {
  log("coverage: lcov.info or merge base with main unavailable — changed_lines omitted");
}

log(`coverage: total ${signals.total}${signals.changed_lines !== undefined ? `, changed_lines ${signals.changed_lines}` : ""}`);
emitResult("coverage", "pass", json, signals);
