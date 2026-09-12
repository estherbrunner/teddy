// `teddy report`: aggregates ADR frontmatter + iterations/*/scores.json +
// git-derived status/PR/baseline into <root>/cockpit/data.js
// (window.__TEDDY_DATA__) and copies the dashboard assets next to it, so the
// static cockpit works from file:// with no server and no fetch. All
// aggregation happens here — the cockpit stays a dumb renderer (adr/0001).
// cockpit/ is a build output, never committed (adr/0005).
// Usage:
//   teddy report [root]           write <root>/cockpit/{data.js,index.html,main.js}
//   teddy report --check [root]   exit 1 if generation fails (writes nothing)
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  isGitRepo,
  listAdrs,
  listIterations,
  loadConfig,
  PACKAGE_ROOT,
  readJson,
  repositoryUrl,
  weightedOverall,
  writeText,
} from "../lib.ts";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();

if (!isGitRepo(root)) {
  console.error("FAIL: cannot derive iterations — not a git repository (adr/0003, adr/0005)");
  process.exit(1);
}

const cfg = await loadConfig(root);
const rubric = cfg.rubric;

const criteriaOut = rubric.criteria.map((c) => ({
  id: c.id,
  description: c.description,
  weight: c.weight,
  judge: c.judge,
  gates: c.gates,
  signals: c.signals.map((s) => `${s.check}.${s.metric}`),
}));

const iterationsOut = listIterations(root, cfg).map((it) => {
  const scores = readJson<{
    timestamp: string;
    criteria: Record<
      string,
      {
        score: number | null;
        judge: string;
        rationale: string;
        gates?: Record<string, string>;
        signals?: Record<string, number>;
      }
    >;
  }>(root, it.scores);
  // Judge surface (adr/0002, redefined by adr/0006): weight on exercised
  // criteria whose score is deterministic (judge "none") over exercised weight.
  let total = 0;
  let deterministic = 0;
  for (const [id, c] of Object.entries(scores.criteria)) {
    if (c.score === null) continue;
    const w = rubric.byId[id]?.weight ?? 0;
    total += w;
    if (rubric.byId[id] && rubric.byId[id].judge === "none") deterministic += w;
  }
  return {
    id: it.id,
    baseline: it.baseline,
    status: it.status,
    pr: it.pr,
    timestamp: scores.timestamp,
    overall: weightedOverall(scores.criteria, rubric) ?? 0,
    judge_surface: { deterministic, total },
    criteria: scores.criteria,
  };
});

const adrsOut = listAdrs(root, cfg).map((a) => ({
  id: a.slug,
  status: a.status,
  assertions: a.assertions,
  criteria: a.rubricRefs,
}));

const data = {
  version: 2,
  generated_by: "teddy report",
  repository: repositoryUrl(root),
  dirs: cfg.dirs,
  rubric: { version: rubric.version, tolerance: rubric.tolerance, criteria: criteriaOut },
  adrs: adrsOut,
  iterations: iterationsOut,
};

const content = `window.__TEDDY_DATA__ = ${JSON.stringify(data, null, 2)};\n`;
const outDir = "cockpit";

if (checkOnly) {
  console.log(`report: OK (${outDir}/data.js generates from the current tree, ${iterationsOut.length} iterations)`);
  process.exit(0);
}

// Dashboard assets: index.html from the package, main.js from its build.
const assets = join(PACKAGE_ROOT, "dist", "cockpit");
const html = existsSync(join(assets, "index.html")) ? join(assets, "index.html") : join(PACKAGE_ROOT, "src", "cockpit", "index.html");
const js = join(assets, "main.js");
mkdirSync(join(root, outDir), { recursive: true });
writeText(root, `${outDir}/data.js`, content);
copyFileSync(html, join(root, outDir, "index.html"));
if (existsSync(js)) copyFileSync(js, join(root, outDir, "main.js"));
else console.error(`report: ${js} missing — run the package build (npm run build) for the dashboard script`);
console.log(`report: wrote ${outDir}/ (${iterationsOut.length} iterations, ${adrsOut.length} ADRs)`);
