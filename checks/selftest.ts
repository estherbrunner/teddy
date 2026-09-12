// Selftest: Teddy's own host check (adr/0007). Verifies that the built-in
// checks fail on broken trees and pass on valid ones, running each as a
// subprocess against throwaway fixture trees — real git repositories, since
// merge traceability is part of the gates (adr/0003) and iteration closure
// and baselines are derived from it (adr/0005, adr/0007).
// Usage: node checks/selftest.ts [--json]
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const checksDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "checks");
const commandsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "commands");
const json = process.argv.includes("--json");

function write(root: string, rel: string, content: string): void {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function readText(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function gitc(root: string, ...args: string[]): void {
  const res = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

function run(root: string, script: string, ...args: string[]): SpawnResult {
  return runEnv(root, {}, script, ...args);
}

function runEnv(
  root: string,
  env: Record<string, string>,
  script: string,
  ...args: string[]
): SpawnResult {
  const dir = script === "report.ts" ? commandsDir : checksDir;
  const res = spawnSync(process.execPath, [join(dir, script), ...args, root], {
    encoding: "utf8",
    // Pin the event context: fixtures must not inherit CI's pull_request
    // environment (strict local semantics unless a case asks otherwise).
    env: { ...process.env, GITHUB_EVENT_NAME: "push", ...env },
  });
  return {
    ok: res.status === 0,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
  };
}

interface SpawnResult {
  ok: boolean;
  output: string;
}

// adr/0007: the rubric lives in teddy.config.ts. The fixture's gate is the
// host check checks/dummy-check.ts (empty → exit 0 → pass by exit code).
const CONFIG = `import type { Config } from "teddy";

export default {
  rubric: {
    version: 2,
    tolerance: 0.1,
    criteria: [
      {
        id: "adr-traceability",
        description: "Every accepted ADR has >=1 linked assertion or criterion",
        weight: 2,
        gates: ["dummy-check"],
        signals: [],
        judge: "none",
      },
      {
        id: "cockpit-clarity",
        description: "Dashboard is clear",
        weight: 1,
        gates: [],
        signals: [],
        judge: "llm",
        anchors: { 0: "unclear", 0.5: "partly", 1: "clear" },
      },
    ],
  },
} satisfies Config;
`;

// Signal-bearing variant: a fake coverage adapter emitting a fixed value.
const CONFIG_SIGNALS = CONFIG.replace(
  'gates: ["dummy-check"],\n        signals: [],',
  'gates: ["dummy-check"],\n        signals: [{ check: "fake-cov", metric: "total", min: 0.5, ratchet: true }],',
);
const FAKE_COV = (value: number): string =>
  `console.log(JSON.stringify({ id: "fake-cov", verdict: "pass", signals: { total: ${value} } }));\n`;

// adr/0003 schema: no approved_by — approval is the merge. adr/0007: the
// frontmatter carries assertions; there is no manifest.
const ADR = `---
id: 0001
status: proposed
supersedes: null
superseded_by: null
assertions: [checks/dummy-check.ts]
rubric_refs: [adr-traceability]
---

# 0001 — Fixture
`;

const ADR_ACCEPTED = ADR.replace("status: proposed", "status: accepted");

const TICKET = `---
id: 0001
type: feature
goal: Fixture iteration.
constraint: each exercised criterion must not decrease against its last recorded score
adr_refs: [0001]
---
`;

// adr/0007: scores.json is timestamp + criteria; everything else is derived.
const SCORES = `{
  "timestamp": "2026-09-11T00:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }, "signals": {} },
    "cockpit-clarity": { "score": null, "judge": "llm", "rationale": "not exercised", "gates": {}, "signals": {} }
  }
}
`;

// Same, with the signal-bearing rubric's evidence recorded.
const SCORES_SIG = (value: number): string =>
  SCORES.replace('"signals": {} },\n    "cockpit', `"signals": { "fake-cov.total": ${value} } },\n    "cockpit`);

// Second iteration variants layered on the valid base.
const SCORES_0002 = `{
  "timestamp": "2026-09-11T01:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }, "signals": {} },
    "cockpit-clarity": { "score": 0, "judge": "llm", "rationale": "worse", "gates": {}, "signals": {} }
  }
}
`;

const SCORES_0002_REGRESSION = `{
  "timestamp": "2026-09-11T01:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }, "signals": {} },
    "cockpit-clarity": { "score": 0.85, "judge": "llm", "rationale": "slipped, see cockpit/main.ts", "gates": {}, "signals": {} }
  }
}
`;

const TICKET_0002 = `---
id: 0002
type: feature
goal: Fixture iteration two.
constraint: each exercised criterion must not decrease against its last recorded score
adr_refs: [0001]
---
`;

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "teddy-selftest-"));
  write(root, ".gitignore", "cockpit/\nnode_modules/\n");
  write(root, "teddy.config.ts", CONFIG);
  write(root, "adr/0001-fixture.md", ADR);
  write(root, "checks/dummy-check.ts", "");
  gitc(root, "init", "-q", "-b", "main");
  gitc(root, "config", "user.email", "check@teddy.local");
  gitc(root, "config", "user.name", "Teddy Check");
  gitc(root, "add", "-A");
  gitc(root, "commit", "-qm", "base");
  // The iteration under review lives on its branch, as in real life; the
  // trunk has no iterations until a merge lands one (adr/0007).
  gitc(root, "checkout", "-qb", "iteration/0001-fixture");
  write(root, "iterations/0001-fixture/ticket.md", TICKET);
  write(root, "iterations/0001-fixture/scores.json", SCORES);
  gitc(root, "add", "-A");
  gitc(root, "commit", "-qm", "scaffold 0001");
  return root;
}

function addIteration(root: string, id: string, scores: string): void {
  write(root, `iterations/${id}/ticket.md`, TICKET_0002.replace("id: 0002", `id: ${id.slice(0, 4)}`));
  write(root, `iterations/${id}/scores.json`, scores);
}
function addIteration0002(root: string, scores: string): void {
  addIteration(root, "0002-fixture", scores);
}

// Land the accepted ADR via a true merge commit — the only acceptance path
// under adr/0003.
function acceptViaMerge(root: string): void {
  gitc(root, "checkout", "-qb", "feat");
  write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
  gitc(root, "add", "-A");
  gitc(root, "commit", "-qm", "accept 0001");
  gitc(root, "checkout", "-q", "main");
  gitc(root, "merge", "-q", "--no-ff", "feat", "-m", "Merge pull request #9 from t/feat");
}

// Land the iteration directory via a true merge commit — the only closure
// path: closed is derived from exactly this trace (adr/0005).
function mergeIteration(root: string, id: string, branch: string, prNo: number): void {
  gitc(root, "checkout", "-qb", branch);
  write(root, `iterations/${id}/scores.json`, `${readText(root, `iterations/${id}/scores.json`)}\n`);
  gitc(root, "add", "-A");
  gitc(root, "commit", "-qm", `close ${id}`);
  gitc(root, "checkout", "-q", "main");
  gitc(root, "merge", "-q", "--no-ff", branch, "-m", `Merge pull request #${prNo} from t/${branch}`);
}

function dataIteration(root: string, id: string): { status: string; pr: number | null; baseline: string | null } | undefined {
  const js = readText(root, "cockpit/data.js");
  const data = JSON.parse(js.slice(js.indexOf("=") + 1).trim().replace(/;$/, ""));
  return data.iterations.find((i: { id: string }) => i.id === id);
}

// adr/0004 fixtures: a package.json declaring linters and fake local .bin
// shims (exit codes only — the gate must run the lockfile-pinned binary,
// never fetch anything).
function pkgWith(deps: Record<string, string>): string {
  return JSON.stringify({ name: "fixture", private: true, devDependencies: deps });
}

function fakeBin(root: string, name: string, code: number): void {
  write(root, `node_modules/.bin/${name}`, `#!/bin/sh\nexit ${code}\n`);
  chmodSync(join(root, "node_modules/.bin", name), 0o755);
}

let passed = 0;
let failed = 0;

function expect(name: string, cond: boolean, detail: string): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

const roots: string[] = [];

try {
  // A — valid tree: every check passes, report --check is stable across runs.
  {
    const root = makeTree();
    roots.push(root);
    const ms = run(root, "manifest-sync.ts");
    const sc = run(root, "scores-check.ts");
    const repCheck = run(root, "report.ts", "--check");
    expect("valid tree: manifest-sync passes", ms.ok, ms.output);
    expect("valid tree: scores-check passes", sc.ok, sc.output);
    expect(
      "valid tree: cockpit-report --check passes without writing",
      repCheck.ok && !existsSync(join(root, "cockpit/data.js")),
      repCheck.output,
    );
    const rep = run(root, "report.ts");
    expect(
      "valid tree: report derives 'open' for an unmerged iteration",
      rep.ok && dataIteration(root, "0001-fixture")?.status === "open" && dataIteration(root, "0001-fixture")?.pr === null,
      rep.output,
    );
  }

  // B' — accepted ADR landed as a direct commit: no merge, no approval.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "accepted directly");
    const ms = run(root, "manifest-sync.ts");
    expect(
      "accepted ADR without merge trace is rejected",
      !ms.ok && ms.output.includes("merge commit"),
      ms.output,
    );
  }

  // C — orphaned assertion: checks/*.ts not linked from manifest.json.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "checks/orphan-check.ts", "");
    const ms = run(root, "manifest-sync.ts");
    expect(
      "orphaned assertion is rejected",
      !ms.ok && ms.output.includes("orphan"),
      ms.output,
    );
  }

  // D — frontmatter links must resolve: unknown criterion, missing
  // assertion file, legacy manifest.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "adr/0001-fixture.md", ADR.replace("rubric_refs: [adr-traceability]", "rubric_refs: [nonexistent]"));
    const ms = run(root, "manifest-sync.ts");
    expect("unknown rubric_ref is rejected", !ms.ok && ms.output.includes("unknown criterion"), ms.output);
    write(root, "adr/0001-fixture.md", ADR.replace("assertions: [checks/dummy-check.ts]", "assertions: [checks/missing.ts]"));
    const ms2 = run(root, "manifest-sync.ts");
    expect("missing assertion file is rejected", !ms2.ok && ms2.output.includes("does not exist"), ms2.output);
    write(root, "adr/0001-fixture.md", ADR.replace("assertions: [checks/dummy-check.ts]", "assertions: [teddy:lint, teddy:nope]"));
    const ms3 = run(root, "manifest-sync.ts");
    expect(
      "teddy: assertion resolves to built-ins only",
      !ms3.ok && ms3.output.includes("'teddy:nope'") && !ms3.output.includes("'teddy:lint'"),
      ms3.output,
    );
  }

  // E — legacy scores.json fields (derived since adr/0007) are rejected.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "iterations/0001-fixture/scores.json", SCORES.replace('"criteria"', '"overall": 1,\n  "baseline": null,\n  "criteria"'));
    const sc = run(root, "scores-check.ts");
    expect(
      "legacy scores fields are rejected",
      !sc.ok && sc.output.includes("legacy field 'overall'") && sc.output.includes("legacy field 'baseline'"),
      sc.output,
    );
  }

  // F1 — an llm criterion drops by more than the tolerance against its last
  // recorded score (1 → 0.85 with tolerance 0.1): rejected. A drop within
  // tolerance passes (F3). Prior: iteration 0001 must first record a 1.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "iterations/0001-fixture/scores.json", SCORES.replace(
      '"score": null, "judge": "llm", "rationale": "not exercised"',
      '"score": 1, "judge": "llm", "rationale": "clear, see cockpit/main.ts"',
    ));
    addIteration0002(root, SCORES_0002_REGRESSION);
    const sc = run(root, "scores-check.ts");
    expect(
      "llm regression beyond tolerance is rejected",
      !sc.ok && sc.output.includes("per-criterion regression") && sc.output.includes("tolerance"),
      sc.output,
    );
    write(root, "iterations/0002-fixture/scores.json", SCORES_0002_REGRESSION.replace('"score": 0.85', '"score": 0.9'));
    const within = run(root, "scores-check.ts");
    expect("llm drop within tolerance passes", within.ok, within.output);
  }

  // F1' — a judge-none criterion is strict: recorded evidence says pass but a
  // gate fails on the tree, or the score disagrees with the evidence.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "checks/dummy-check.ts", "process.exit(1);\n");
    const sc = run(root, "scores-check.ts");
    expect(
      "recorded gate 'pass' that fails on the tree is rejected",
      !sc.ok && sc.output.includes("fails on this tree"),
      sc.output,
    );
    write(root, "checks/dummy-check.ts", "");
    write(root, "iterations/0001-fixture/scores.json", SCORES.replace('"score": 1, "judge": "none"', '"score": 0.5, "judge": "none"'));
    const half = run(root, "scores-check.ts");
    expect(
      "judge none with passing evidence must score 1",
      !half.ok && half.output.includes("must be 1"),
      half.output,
    );
  }

  // F4 — evidence bounds: an llm score above 0.5 with a skipped gate, and one
  // with no evidence whose rationale cites no file, are both capped.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "teddy.config.ts", CONFIG.replace('gates: [],\n        signals: [],\n        judge: "llm"', 'gates: ["dummy-check"],\n        signals: [],\n        judge: "llm"'));
    write(root, "checks/dummy-check.ts", 'console.log(JSON.stringify({ id: "dummy-check", verdict: "skip", signals: {} }));\n');
    write(root, "iterations/0001-fixture/scores.json", SCORES
      .replace('"score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }', '"score": null, "judge": "none", "rationale": "skipped", "gates": { "dummy-check": "skip" }')
      .replace('"score": null, "judge": "llm", "rationale": "not exercised", "gates": {}', '"score": 0.9, "judge": "llm", "rationale": "fine", "gates": { "dummy-check": "skip" }'));
    const sc = run(root, "scores-check.ts");
    expect(
      "llm score above 0.5 with skipped evidence is capped",
      !sc.ok && sc.output.includes("capped at 0.5"),
      sc.output,
    );
    const root2 = makeTree();
    roots.push(root2);
    write(root2, "iterations/0001-fixture/scores.json", SCORES
      .replace('"score": null, "judge": "llm", "rationale": "not exercised"', '"score": 0.9, "judge": "llm", "rationale": "looks great"'));
    const sc2 = run(root2, "scores-check.ts");
    expect(
      "llm score above 0.5 with no evidence and no cited file is capped",
      !sc2.ok && sc2.output.includes("citing no file"),
      sc2.output,
    );
  }

  // F5 — signals: threshold is a gate, recorded value must match the
  // measurement, and a ratchet signal may not regress.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "teddy.config.ts", CONFIG_SIGNALS);
    write(root, "checks/fake-cov.ts", FAKE_COV(0.8));
    write(root, "iterations/0001-fixture/scores.json", SCORES_SIG(0.8));
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "signals");
    const ok = run(root, "scores-check.ts");
    expect("signal recorded and measured in agreement passes", ok.ok, ok.output);
    write(root, "iterations/0001-fixture/scores.json", SCORES_SIG(0.9));
    const lie = run(root, "scores-check.ts");
    expect(
      "signal recorded above its measurement is rejected",
      !lie.ok && lie.output.includes("but measures 0.8"),
      lie.output,
    );
    write(root, "checks/fake-cov.ts", FAKE_COV(0.4));
    write(root, "iterations/0001-fixture/scores.json", SCORES_SIG(0.4));
    const low = run(root, "scores-check.ts");
    expect(
      "signal below its min threshold is rejected",
      !low.ok && low.output.includes("< min 0.5"),
      low.output,
    );
    // Ratchet: 0001 recorded 0.8 (merged), 0002 measures 0.7 — regression.
    write(root, "checks/fake-cov.ts", FAKE_COV(0.8));
    write(root, "iterations/0001-fixture/scores.json", SCORES_SIG(0.8));
    mergeIteration(root, "0001-fixture", "close-sig", 20);
    write(root, "checks/fake-cov.ts", FAKE_COV(0.7));
    addIteration0002(root, SCORES_0002
      .replace('"gates": { "dummy-check": "pass" }, "signals": {} }', '"gates": { "dummy-check": "pass" }, "signals": { "fake-cov.total": 0.7 } }'));
    const ratchet = run(root, "scores-check.ts");
    expect(
      "ratchet signal regression is rejected",
      !ratchet.ok && ratchet.output.includes("ratchet"),
      ratchet.output,
    );
  }

  // F6 — the config is data: any import beyond types is rejected; the
  // rubric is validated; gates must resolve; unknown keys fail.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "teddy.config.ts", CONFIG.replace('import type { Config } from "teddy";', 'import type { Config } from "teddy";\nimport { execSync } from "node:child_process";'));
    const ms = run(root, "manifest-sync.ts");
    expect(
      "config importing anything but types is rejected",
      !ms.ok && ms.output.includes("only 'import type"),
      ms.output,
    );
    write(root, "teddy.config.ts", CONFIG.replace('anchors: { 0: "unclear", 0.5: "partly", 1: "clear" },', ''));
    const noAnchors = run(root, "manifest-sync.ts");
    expect(
      "llm criterion without anchors is rejected",
      !noAnchors.ok && noAnchors.output.includes("requires anchors"),
      noAnchors.output,
    );
    write(root, "teddy.config.ts", CONFIG.replace('gates: ["dummy-check"]', 'gates: ["nonexistent"]'));
    const noGate = run(root, "manifest-sync.ts");
    expect(
      "gate without a check script is rejected",
      !noGate.ok && noGate.output.includes("resolves to no check"),
      noGate.output,
    );
    write(root, "teddy.config.ts", CONFIG.replace("export default {", "export default {\n  bogus: 1,"));
    const unknown = run(root, "manifest-sync.ts");
    expect("unknown config key is rejected", !unknown.ok && unknown.output.includes("unknown key 'bogus'"), unknown.output);
  }

  // F7 — zero-config host: no teddy.config.ts → default rubric, default dirs;
  // a host check overrides a built-in of the same id.
  {
    const root = makeTree();
    roots.push(root);
    rmSync(join(root, "teddy.config.ts"));
    write(root, "package.json", pkgWith({}));
    write(root, "adr/0001-fixture.md", ADR.replace("rubric_refs: [adr-traceability]", "rubric_refs: [traceability]"));
    write(root, "iterations/0001-fixture/scores.json", `{
  "timestamp": "2026-09-11T00:00:00Z",
  "criteria": {
    "traceability": { "score": 1, "judge": "none", "rationale": "ok", "gates": { "manifest-sync": "pass" }, "signals": {} },
    "hygiene": { "score": null, "judge": "none", "rationale": "typecheck and lint skipped: nothing declared", "gates": { "typecheck": "skip", "lint": "skip" }, "signals": {} },
    "correctness": { "score": null, "judge": "none", "rationale": "no test runner", "gates": { "test": "skip" }, "signals": {} }
  }
}
`);
    const ms = run(root, "manifest-sync.ts");
    const sc = run(root, "scores-check.ts");
    expect("zero-config host: manifest-sync passes with the default rubric", ms.ok, ms.output);
    expect("zero-config host: scores-check verifies built-in gates", sc.ok, sc.output);
    // Override: a host checks/lint.ts that fails must win over the built-in.
    write(root, "checks/lint.ts", "process.exit(1);\n");
    write(root, "adr/0001-fixture.md", ADR.replace("rubric_refs: [adr-traceability]", "rubric_refs: [traceability]").replace("assertions: [checks/dummy-check.ts]", "assertions: [checks/dummy-check.ts, checks/lint.ts]"));
    const over = run(root, "scores-check.ts");
    expect(
      "host check overrides the built-in of the same id",
      !over.ok && over.output.includes("gate 'lint' fails on this tree"),
      over.output,
    );
  }

  // F8 — derived baselines (adr/0007): linear merges, several iterations in
  // one merge (by number), and concurrent branches off the same trunk.
  {
    const root = makeTree();
    roots.push(root);
    // 0001 and 0002 land in one merge; 0003 in the next.
    addIteration0002(root, SCORES_0002);
    gitc(root, "checkout", "-qb", "pr1");
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "0001+0002");
    gitc(root, "checkout", "-q", "main");
    gitc(root, "merge", "-q", "--no-ff", "pr1", "-m", "Merge pull request #1 from t/pr1");
    addIteration(root, "0003-fixture", SCORES_0002);
    gitc(root, "checkout", "-qb", "pr2");
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "0003");
    gitc(root, "checkout", "-q", "main");
    gitc(root, "merge", "-q", "--no-ff", "pr2", "-m", "Merge pull request #2 from t/pr2");
    const rep = run(root, "report.ts");
    const b1 = dataIteration(root, "0001-fixture");
    const b2 = dataIteration(root, "0002-fixture");
    const b3 = dataIteration(root, "0003-fixture");
    expect(
      "baseline chain follows merge order, then number within a merge",
      rep.ok && b1?.baseline === null && b2?.baseline === "0001-fixture" && b3?.baseline === "0002-fixture" && b1?.pr === 1 && b3?.pr === 2,
      `${rep.output}${JSON.stringify([b1, b2, b3])}`,
    );
    // Two concurrent branches off main: each sees 0003 as its baseline,
    // regardless of directory number.
    gitc(root, "checkout", "-qb", "pr-a");
    addIteration(root, "0005-fixture", SCORES_0002);
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "0005");
    gitc(root, "checkout", "-q", "main");
    gitc(root, "checkout", "-qb", "pr-b");
    addIteration(root, "0004-fixture", SCORES_0002);
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "0004");
    const repB = run(root, "report.ts");
    const b4 = dataIteration(root, "0004-fixture");
    expect(
      "open iteration on a branch baselines on the last iteration at the merge base",
      repB.ok && b4?.baseline === "0003-fixture" && b4?.status === "open" && dataIteration(root, "0005-fixture") === undefined,
      `${repB.output}${JSON.stringify(b4)}`,
    );
    gitc(root, "checkout", "-q", "pr-a");
    const repA = run(root, "report.ts");
    expect(
      "the concurrent branch sees the same baseline",
      repA.ok && dataIteration(root, "0005-fixture")?.baseline === "0003-fixture",
      repA.output,
    );
    // Land pr-a, then pr-b: 0004 (merged later) baselines on 0005.
    gitc(root, "checkout", "-q", "main");
    gitc(root, "merge", "-q", "--no-ff", "pr-a", "-m", "Merge pull request #3 from t/pr-a");
    gitc(root, "merge", "-q", "--no-ff", "pr-b", "-m", "Merge pull request #4 from t/pr-b");
    const repM = run(root, "report.ts");
    expect(
      "after both merge, baselines follow merge order not number",
      repM.ok && dataIteration(root, "0005-fixture")?.baseline === "0003-fixture" && dataIteration(root, "0004-fixture")?.baseline === "0005-fixture",
      repM.output,
    );
  }

  // F2 — the bootstrap comparability wrinkle: an iteration exercising MORE
  // criteria than its baseline, with an honest 0 on the new one. The old
  // aggregate gate rejected this; the per-criterion gate must pass it.
  {
    const root = makeTree();
    roots.push(root);
    addIteration0002(root, SCORES_0002);
    const sc = run(root, "scores-check.ts");
    expect(
      "expanded criteria set with new-criterion score passes (wrinkle fixed)",
      sc.ok,
      sc.output,
    );
  }

  // G — data.js is a build output (adr/0005): a hand-edited or stale copy is
  // simply overwritten by generation; --check never consults it.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "cockpit/data.js", "window.__TEDDY_DATA__ = { stale: true };\n");
    const check = run(root, "report.ts", "--check");
    const rep = run(root, "report.ts");
    expect(
      "stale data.js is ignored by --check and overwritten by generation",
      check.ok && rep.ok && !readText(root, "cockpit/data.js").includes("stale"),
      `${check.output}${rep.output}`,
    );
  }

  // H' — accepted ADR landed via a true merge commit: gate must allow.
  {
    const root = makeTree();
    roots.push(root);
    acceptViaMerge(root);
    const ms = run(root, "manifest-sync.ts");
    expect("accepted ADR with merge trace passes gate", ms.ok, ms.output);
  }

  // J1 — an iteration on the trunk without a merge commit (squash/rebase or
  // direct commit) cannot be closed: rejected, on main and on branches off it.
  {
    const root = makeTree();
    roots.push(root);
    gitc(root, "checkout", "-q", "main");
    addIteration(root, "0002-fixture", SCORES);
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "0002 committed straight to main");
    const sc = run(root, "scores-check.ts");
    expect(
      "iteration on the trunk without a merge trace is rejected",
      !sc.ok && sc.output.includes("squash/rebase"),
      sc.output,
    );
    gitc(root, "checkout", "-qb", "feat");
    const onBranch = run(root, "scores-check.ts");
    expect(
      "on a branch off that trunk it is still rejected (it is at the merge base)",
      !onBranch.ok && onBranch.output.includes("squash/rebase"),
      onBranch.output,
    );
  }

  // J2 — merged via a true merge commit: derived status flips to closed with
  // no field written anywhere.
  {
    const root = makeTree();
    roots.push(root);
    mergeIteration(root, "0001-fixture", "close-1", 10);
    const sc = run(root, "scores-check.ts");
    const rep = run(root, "report.ts");
    expect("merged iteration passes scores-check", sc.ok, sc.output);
    const it = dataIteration(root, "0001-fixture");
    expect(
      "merged iteration is derived as 'closed' with its PR number in data.js",
      rep.ok && it?.status === "closed" && it?.pr === 10,
      rep.output,
    );
    // A later PR touching the directory must not steal the landing PR.
    mergeIteration(root, "0001-fixture", "touch-1", 12);
    const again = run(root, "report.ts");
    expect(
      "derived PR is the oldest merge touching the iteration, not the latest",
      again.ok && dataIteration(root, "0001-fixture")?.pr === 10,
      again.output,
    );
  }

  // J4 — accepted ADR on a pull-request run: the branch carries the status,
  // the merge realizes it — trace is pending there, reconciled on main.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "accept on branch");
    const ms = runEnv(root, { GITHUB_EVENT_NAME: "pull_request" }, "manifest-sync.ts");
    expect(
      "accepted ADR on a PR branch defers trace to main",
      ms.ok && ms.output.includes("pending merge"),
      ms.output,
    );
  }

  // J5 — legacy 'pr' in a ticket: the PR is read off the merge commit.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "iterations/0001-fixture/ticket.md", TICKET.replace("adr_refs: [0001]", "adr_refs: [0001]\npr: null"));
    const sc = run(root, "scores-check.ts");
    expect(
      "legacy ticket pr field is rejected",
      !sc.ok && sc.output.includes("legacy field 'pr'"),
      sc.output,
    );
  }

  // K — legacy field guards: reintroducing approved_by anywhere fails.
  {
    const root = makeTree();
    roots.push(root);
    write(
      root,
      "adr/0001-fixture.md",
      ADR.replace(
        "rubric_refs: [adr-traceability]",
        "approved_by: someone\nrubric_refs: [adr-traceability]",
      ),
    );
    write(root, "iterations/0001-fixture/scores.json", SCORES.replace('"criteria"', '"approved_by": "someone",\n  "criteria"'));
    const ms = run(root, "manifest-sync.ts");
    const sc = run(root, "scores-check.ts");
    expect(
      "legacy approved_by in ADR is rejected",
      !ms.ok && ms.output.includes("legacy"),
      ms.output,
    );
    expect(
      "legacy approved_by in scores.json is rejected",
      !sc.ok && sc.output.includes("legacy"),
      sc.output,
    );
  }

  // T1 — typecheck adapter: not declared → skip; declared, not installed → fail;
  // installed → runs the local tsc.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", pkgWith({}));
    const skip = run(root, "typecheck.ts");
    expect("typecheck: not declared skips", skip.ok && skip.output.includes("skipped"), skip.output);
    write(root, "package.json", pkgWith({ typescript: "^5.0.0" }));
    const missing = run(root, "typecheck.ts");
    expect("typecheck: declared but not installed fails", !missing.ok && missing.output.includes("not installed"), missing.output);
    fakeBin(root, "tsc", 0);
    const ok = run(root, "typecheck.ts", "--json");
    expect("typecheck: --json reports pass", ok.ok && ok.output.includes('"verdict":"pass"'), ok.output);
  }

  // T2 — test adapter: declared runner wins; no runner + test files → node --test
  // over the discovered files; nothing → skip. checks/test.ts must not be
  // discovered as a test file.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", pkgWith({}));
    write(root, "checks/test.ts", ""); // a host check named test.ts must not be discovered as a test file
    const skip = run(root, "test.ts", "--json");
    expect("test: no runner and no test files skips", skip.ok && skip.output.includes('"verdict":"skip"'), skip.output);
    write(root, "src/sum.test.mjs", 'import test from "node:test"; test("ok", () => {});\n');
    const node = run(root, "test.ts", "--json");
    expect("test: node --test fallback runs discovered files", node.ok && node.output.includes("node --test over 1 file") && node.output.includes('"verdict":"pass"'), node.output);
    write(root, "src/sum.test.mjs", 'import test from "node:test"; test("bad", () => { throw new Error("x"); });\n');
    const failing = run(root, "test.ts");
    expect("test: failing node --test fails the gate", !failing.ok, failing.output);
    write(root, "package.json", pkgWith({ vitest: "^2.0.0" }));
    fakeBin(root, "vitest", 0);
    const vitest = run(root, "test.ts", "--json");
    expect("test: declared runner takes priority over node --test", vitest.ok && vitest.output.includes("vitest") && !vitest.output.includes("node --test"), vitest.output);
  }

  // T3 — coverage adapter: reads json-summary; changed_lines from lcov ∩ diff.
  {
    const root = makeTree();
    roots.push(root);
    const skip = run(root, "coverage.ts", "--json");
    expect("coverage: no summary skips", skip.ok && skip.output.includes('"verdict":"skip"'), skip.output);
    gitc(root, "checkout", "-qb", "feat");
    write(root, "src/a.js", "line1\nline2\nline3\n");
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "add a.js");
    write(root, "coverage/coverage-summary.json", JSON.stringify({ total: { lines: { pct: 75 } } }));
    write(root, "coverage/lcov.info", "SF:src/a.js\nDA:1,1\nDA:2,0\nDA:3,1\nend_of_record\n");
    const cov = run(root, "coverage.ts", "--json");
    expect(
      "coverage: total from summary and changed_lines from lcov ∩ diff",
      cov.ok && cov.output.includes('"total":0.75') && cov.output.includes('"changed_lines":0.6667'),
      cov.output,
    );
  }

  // L1 — no supported linter declared: the gate skips with an explicit note
  // (declaring a linter in package.json is the configuration — adr/0004).
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", pkgWith({ typescript: "^5.0.0" }));
    const lint = run(root, "lint.ts");
    expect(
      "lint gate: no declared linter skips with a note",
      lint.ok && lint.output.includes("no supported linter"),
      lint.output,
    );
  }

  // L2 — declared linter with a green local binary passes.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", pkgWith({ "@biomejs/biome": "^1.0.0" }));
    fakeBin(root, "biome", 0);
    const lint = run(root, "lint.ts");
    expect(
      "lint gate: declared linter exits 0 — pass",
      lint.ok && lint.output.includes("biome"),
      lint.output,
    );
  }

  // L3 — linter findings (non-zero exit) must fail the gate.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", pkgWith({ "@biomejs/biome": "^1.0.0" }));
    fakeBin(root, "biome", 1);
    const lint = run(root, "lint.ts");
    expect(
      "lint gate: linter findings are rejected",
      !lint.ok && lint.output.includes("exit code 1"),
      lint.output,
    );
  }

  // L4 — declared but not installed: a declared gate that cannot run is broken.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", pkgWith({ eslint: "^9.0.0" }));
    const lint = run(root, "lint.ts");
    expect(
      "lint gate: declared but not installed is rejected",
      !lint.ok && lint.output.includes("not installed"),
      lint.output,
    );
  }

  // L5 — fixed priority order: the first supported linter in the table wins.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", pkgWith({ eslint: "^9.0.0", "@biomejs/biome": "^1.0.0" }));
    fakeBin(root, "biome", 0);
    fakeBin(root, "eslint", 7);
    const lint = run(root, "lint.ts");
    expect(
      "lint gate: priority order picks the first supported linter",
      lint.ok && lint.output.includes("biome") && !lint.output.includes("eslint"),
      lint.output,
    );
  }

  // L6 — unparseable package.json: the gate cannot verify, fails closed.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "package.json", "{ not json");
    const lint = run(root, "lint.ts");
    expect(
      "lint gate: unparseable package.json is rejected",
      !lint.ok && lint.output.includes("package.json"),
      lint.output,
    );
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log(`\nselftest: ${passed} passed, ${failed} failed`);
if (json) console.log(JSON.stringify({ id: "selftest", verdict: failed > 0 ? "fail" : "pass", signals: {} }));
process.exit(failed > 0 ? 1 : 0);
