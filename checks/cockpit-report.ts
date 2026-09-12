// Aggregates manifest.json + manifest-of-iterations.json + iterations/*/scores.json
// into cockpit/data.js (window.__TEDDY_DATA__) so the static cockpit works from
// file:// with no server and no fetch. All aggregation happens here — the cockpit
// stays a dumb renderer (adr/0001: no aggregation logic duplicated in TS/JS).
// data.js is a build output, never committed (adr/0005): iteration closure is
// derived from merge history at generation time, so the file is exactly as
// fresh as the ref it was generated from.
// Usage:
//   node checks/cockpit-report.ts [root]          regenerate cockpit/data.js
//   node checks/cockpit-report.ts --check [root]  exit 1 if generation fails (writes nothing)
import { isGitRepo, iterationStatus, parseRubric, readJson, readText, repositoryUrl, writeText } from "./lib.ts";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();

if (!isGitRepo(root)) {
  console.error("FAIL: cannot derive iteration closure — not a git repository (adr/0003, adr/0005)");
  process.exit(1);
}

const rubric = parseRubric(readText(root, "rubrics/rubric.yaml"));
const manifest = readJson<{
  version: number;
  adrs: Record<string, { status: string; assertions: string[]; criteria: string[] }>;
}>(root, "manifest.json");
const registry = readJson<{
  version: number;
  iterations: { id: string; scores: string; baseline: string | null }[];
}>(root, "manifest-of-iterations.json");

const criteriaOut = Object.values(rubric.criteria).map((c) => ({
  id: c.id,
  description: c.description,
  weight: c.weight,
  judge: c.judge,
}));

const iterationsOut = registry.iterations.map((entry) => {
  const scores = readJson<{
    timestamp: string;
    criteria: Record<string, { score: number | null; judge: string; rationale: string }>;
    overall: number;
    deterministic_gate: string;
  }>(root, entry.scores);
  let total = 0;
  let deterministic = 0;
  for (const [id, c] of Object.entries(scores.criteria)) {
    if (c.score === null) continue;
    total++;
    if (rubric.criteria[id] && rubric.criteria[id].judge !== "llm") deterministic++;
  }
  return {
    id: entry.id,
    baseline: entry.baseline,
    status: iterationStatus(root, entry.id),
    timestamp: scores.timestamp,
    overall: scores.overall,
    deterministic_gate: scores.deterministic_gate,
    judge_surface: { deterministic, total },
    criteria: scores.criteria,
  };
});

const adrsOut = Object.entries(manifest.adrs).map(([id, a]) => ({
  id,
  status: a.status,
  assertions: a.assertions,
  criteria: a.criteria,
}));

const data = {
  version: 1,
  generated_by: "checks/cockpit-report.ts",
  repository: repositoryUrl(root),
  rubric: { version: rubric.version, criteria: criteriaOut },
  adrs: adrsOut,
  iterations: iterationsOut,
};

const content = `window.__TEDDY_DATA__ = ${JSON.stringify(data, null, 2)};\n`;
const dataRel = "cockpit/data.js";

if (checkOnly) {
  console.log(`cockpit-report: OK (${dataRel} generates from the current tree, ${iterationsOut.length} iterations)`);
  process.exit(0);
}

writeText(root, dataRel, content);
console.log(
  `cockpit-report: wrote ${dataRel} (${iterationsOut.length} iterations, ${adrsOut.length} ADRs)`,
);
