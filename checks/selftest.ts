// Selftest: verifies that Teddy's deterministic checks fail on broken trees
// and pass on valid ones. Runs each check as a subprocess against throwaway
// fixture trees — real git repositories, since merge traceability is part of
// the gates (adr/0003: merge = approval) and iteration closure is derived
// from it (adr/0005).
// Usage: node checks/selftest.ts
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const checksDir = dirname(fileURLToPath(import.meta.url));

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
  const res = spawnSync(process.execPath, [join(checksDir, script), ...args, root], {
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

// adr/0006: the rubric is a typed TS module. The fixture's gate is the
// empty checks/dummy-check.ts (exit 0 → pass by exit code).
const RUBRIC = `import type { Rubric } from "../checks/lib.ts";

export default {
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
  adrs: { "0001-fixture": ["adr-traceability"] },
} satisfies Rubric;
`;

// Signal-bearing variant: a fake coverage adapter emitting a fixed value.
const RUBRIC_SIGNALS = RUBRIC.replace(
  'gates: ["dummy-check"],\n      signals: [],',
  'gates: ["dummy-check"],\n      signals: [{ check: "fake-cov", metric: "total", min: 0.5, ratchet: true }],',
);
const FAKE_COV = (value: number): string =>
  `console.log(JSON.stringify({ id: "fake-cov", verdict: "pass", signals: { total: ${value} } }));\n`;

// adr/0003 schema: no approved_by — approval is the merge.
const ADR = `---
id: 0001
status: proposed
supersedes: null
superseded_by: null
rubric_refs: [adr-traceability]
---

# 0001 — Fixture
`;

const ADR_ACCEPTED = ADR.replace("status: proposed", "status: accepted");

const MANIFEST = `{
  "version": 1,
  "adrs": {
    "0001-fixture": {
      "status": "proposed",
      "assertions": ["checks/dummy-check.ts"],
      "criteria": ["adr-traceability"]
    }
  }
}
`;

const MANIFEST_OF_ITERATIONS = `{
  "version": 1,
  "iterations": [
    {
      "id": "0001-fixture",
      "ticket": "iterations/0001-fixture/ticket.md",
      "scores": "iterations/0001-fixture/scores.json",
      "baseline": null
    }
  ]
}
`;

const TICKET = `---
id: 0001
type: feature
goal: Fixture iteration.
constraint: each exercised criterion must not decrease against its last recorded score
adr_refs: [0001]
---
`;

const SCORES = `{
  "iteration": "0001-fixture",
  "ticket": "0001",
  "baseline": null,
  "timestamp": "2026-09-11T00:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }, "signals": {} },
    "cockpit-clarity": { "score": null, "judge": "llm", "rationale": "not exercised", "gates": {}, "signals": {} }
  },
  "overall": 1,
  "deterministic_gate": "pass"
}
`;

// Same, with the signal-bearing rubric's evidence recorded.
const SCORES_SIG = (value: number): string =>
  SCORES.replace('"signals": {} },\n    "cockpit', `"signals": { "fake-cov.total": ${value} } },\n    "cockpit`);

// Second iteration variants layered on the valid base. Under the adr/0001
// amended gate (paired per-criterion non-regression) F1 must fail and F2
// must pass.
const SCORES_0002 = `{
  "iteration": "0002-fixture",
  "ticket": "0002",
  "baseline": "0001-fixture",
  "timestamp": "2026-09-11T01:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }, "signals": {} },
    "cockpit-clarity": { "score": 0, "judge": "llm", "rationale": "worse", "gates": {}, "signals": {} }
  },
  "overall": 0.6666666666666666,
  "deterministic_gate": "pass"
}
`;

const SCORES_0002_REGRESSION = `{
  "iteration": "0002-fixture",
  "ticket": "0002",
  "baseline": "0001-fixture",
  "timestamp": "2026-09-11T01:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }, "signals": {} },
    "cockpit-clarity": { "score": 0.85, "judge": "llm", "rationale": "slipped, see cockpit/main.ts", "gates": {}, "signals": {} }
  },
  "overall": 0.95,
  "deterministic_gate": "pass"
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
  write(root, "rubrics/rubric.ts", RUBRIC);
  write(root, "adr/0001-fixture.md", ADR);
  write(root, "manifest.json", MANIFEST);
  write(root, "manifest-of-iterations.json", MANIFEST_OF_ITERATIONS);
  write(root, "checks/dummy-check.ts", "");
  write(root, "iterations/0001-fixture/ticket.md", TICKET);
  write(root, "iterations/0001-fixture/scores.json", SCORES);
  gitc(root, "init", "-q", "-b", "main");
  gitc(root, "config", "user.email", "check@teddy.local");
  gitc(root, "config", "user.name", "Teddy Check");
  gitc(root, "add", "-A");
  gitc(root, "commit", "-qm", "base");
  return root;
}

function addIteration0002(root: string, scores: string): void {
  write(root, "iterations/0002-fixture/ticket.md", TICKET_0002);
  write(root, "iterations/0002-fixture/scores.json", scores);
  const entries = JSON.parse(readText(root, "manifest-of-iterations.json"));
  entries.iterations.push({
    id: "0002-fixture",
    ticket: "iterations/0002-fixture/ticket.md",
    scores: "iterations/0002-fixture/scores.json",
    baseline: "0001-fixture",
  });
  write(root, "manifest-of-iterations.json", `${JSON.stringify(entries, null, 2)}\n`);
}

// Land the accepted ADR (and mirrored manifest status) via a true merge
// commit — the only acceptance path under adr/0003.
function acceptViaMerge(root: string, withManifest = true): void {
  gitc(root, "checkout", "-qb", "feat");
  write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
  if (withManifest) {
    const m = JSON.parse(readText(root, "manifest.json"));
    m.adrs["0001-fixture"].status = "accepted";
    write(root, "manifest.json", `${JSON.stringify(m, null, 2)}\n`);
  }
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

function dataIteration(root: string, id: string): { status: string; pr: number | null } | undefined {
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
    const repCheck = run(root, "cockpit-report.ts", "--check");
    expect("valid tree: manifest-sync passes", ms.ok, ms.output);
    expect("valid tree: scores-check passes", sc.ok, sc.output);
    expect(
      "valid tree: cockpit-report --check passes without writing",
      repCheck.ok && !existsSync(join(root, "cockpit/data.js")),
      repCheck.output,
    );
    const rep = run(root, "cockpit-report.ts");
    expect(
      "valid tree: cockpit-report derives 'open' for an unmerged iteration",
      rep.ok && dataIteration(root, "0001-fixture")?.status === "open" && dataIteration(root, "0001-fixture")?.pr === null,
      rep.output,
    );
  }

  // B' — accepted ADR landed as a direct commit: no merge, no approval.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
    const m = JSON.parse(readText(root, "manifest.json"));
    m.adrs["0001-fixture"].status = "accepted";
    write(root, "manifest.json", `${JSON.stringify(m, null, 2)}\n`);
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

  // D — manifest criteria drift against rubric.ts.
  {
    const root = makeTree();
    roots.push(root);
    const manifest = JSON.parse(readText(root, "manifest.json"));
    manifest.adrs["0001-fixture"].criteria = ["adr-traceability", "cockpit-clarity"];
    write(root, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    const ms = run(root, "manifest-sync.ts");
    expect(
      "manifest/rubric criteria drift is rejected",
      !ms.ok && ms.output.includes("drift"),
      ms.output,
    );
  }

  // E — stored overall disagrees with the weighted aggregation formula.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "iterations/0001-fixture/scores.json", SCORES.replace('"overall": 1', '"overall": 0.5'));
    const sc = run(root, "scores-check.ts");
    expect(
      "wrong precomputed overall is rejected",
      !sc.ok && sc.output.includes("overall"),
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
    write(root, "iterations/0002-fixture/scores.json", SCORES_0002_REGRESSION.replace('"score": 0.85', '"score": 0.9').replace('"overall": 0.95', '"overall": 0.9666666666666667'));
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
    write(root, "iterations/0001-fixture/scores.json", SCORES.replace('"score": 1, "judge": "none"', '"score": 0.5, "judge": "none"').replace('"overall": 1', '"overall": 0.5'));
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
    write(root, "rubrics/rubric.ts", RUBRIC.replace('gates: [],\n      signals: [],\n      judge: "llm"', 'gates: ["dummy-check"],\n      signals: [],\n      judge: "llm"'));
    write(root, "checks/dummy-check.ts", 'console.log(JSON.stringify({ id: "dummy-check", verdict: "skip", signals: {} }));\n');
    write(root, "iterations/0001-fixture/scores.json", SCORES
      .replace('"score": 1, "judge": "none", "rationale": "ok", "gates": { "dummy-check": "pass" }', '"score": null, "judge": "none", "rationale": "skipped", "gates": { "dummy-check": "skip" }')
      .replace('"score": null, "judge": "llm", "rationale": "not exercised", "gates": {}', '"score": 0.9, "judge": "llm", "rationale": "fine", "gates": { "dummy-check": "skip" }')
      .replace('"overall": 1', '"overall": 0.9'));
    const sc = run(root, "scores-check.ts");
    expect(
      "llm score above 0.5 with skipped evidence is capped",
      !sc.ok && sc.output.includes("capped at 0.5"),
      sc.output,
    );
    const root2 = makeTree();
    roots.push(root2);
    write(root2, "iterations/0001-fixture/scores.json", SCORES
      .replace('"score": null, "judge": "llm", "rationale": "not exercised"', '"score": 0.9, "judge": "llm", "rationale": "looks great"')
      .replace('"overall": 1', '"overall": 0.9333333333333333'));
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
    write(root, "rubrics/rubric.ts", RUBRIC_SIGNALS);
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

  // F6 — the rubric is code: any import beyond its own type is rejected.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "rubrics/rubric.ts", RUBRIC.replace('import type { Rubric } from "../checks/lib.ts";', 'import type { Rubric } from "../checks/lib.ts";\nimport { execSync } from "node:child_process";'));
    const ms = run(root, "manifest-sync.ts");
    expect(
      "rubric importing anything but its type is rejected",
      !ms.ok && ms.output.includes("only 'import type"),
      ms.output,
    );
    write(root, "rubrics/rubric.ts", RUBRIC.replace('anchors: { 0: "unclear", 0.5: "partly", 1: "clear" },', ''));
    const noAnchors = run(root, "manifest-sync.ts");
    expect(
      "llm criterion without anchors is rejected",
      !noAnchors.ok && noAnchors.output.includes("requires anchors"),
      noAnchors.output,
    );
    write(root, "rubrics/rubric.ts", RUBRIC.replace('gates: ["dummy-check"]', 'gates: ["nonexistent"]'));
    const noGate = run(root, "manifest-sync.ts");
    expect(
      "gate without a check script is rejected",
      !noGate.ok && noGate.output.includes("has no checks/nonexistent.ts"),
      noGate.output,
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
    const check = run(root, "cockpit-report.ts", "--check");
    const rep = run(root, "cockpit-report.ts");
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

  // I — --fix resolves status drift and must exit clean, not report
  // the pre-fix failures.
  {
    const root = makeTree();
    roots.push(root);
    acceptViaMerge(root, false); // merged, but manifest still says proposed
    const first = run(root, "manifest-sync.ts", "--fix");
    expect("manifest-sync --fix syncs drift and exits 0", first.ok, first.output);
    const second = run(root, "manifest-sync.ts");
    expect("manifest-sync passes after --fix", second.ok, second.output);
  }

  // J1 — legacy 'status' in the registry: closure is derived, never stored.
  {
    const root = makeTree();
    roots.push(root);
    const entries = JSON.parse(readText(root, "manifest-of-iterations.json"));
    entries.iterations[0].status = "closed";
    write(root, "manifest-of-iterations.json", `${JSON.stringify(entries, null, 2)}\n`);
    const sc = run(root, "scores-check.ts");
    expect(
      "legacy registry status field is rejected",
      !sc.ok && sc.output.includes("legacy field 'status'"),
      sc.output,
    );
  }

  // J2 — merged via a true merge commit: derived status flips to closed with
  // no field written anywhere.
  {
    const root = makeTree();
    roots.push(root);
    mergeIteration(root, "0001-fixture", "close-1", 10);
    const sc = run(root, "scores-check.ts");
    const rep = run(root, "cockpit-report.ts");
    expect("merged iteration passes scores-check", sc.ok, sc.output);
    const it = dataIteration(root, "0001-fixture");
    expect(
      "merged iteration is derived as 'closed' with its PR number in data.js",
      rep.ok && it?.status === "closed" && it?.pr === 10,
      rep.output,
    );
    // A later PR touching the directory must not steal the landing PR.
    mergeIteration(root, "0001-fixture", "touch-1", 12);
    const again = run(root, "cockpit-report.ts");
    expect(
      "derived PR is the oldest merge touching the iteration, not the latest",
      again.ok && dataIteration(root, "0001-fixture")?.pr === 10,
      again.output,
    );
  }

  // J3 — out-of-order: the second iteration merges while its baseline never
  // did (direct commit) — the baseline chain must reject it.
  {
    const root = makeTree();
    roots.push(root);
    addIteration0002(root, SCORES_0002);
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "scaffold 0002");
    mergeIteration(root, "0002-fixture", "close-2", 11);
    const sc = run(root, "scores-check.ts");
    expect(
      "iteration merged before its baseline is rejected",
      !sc.ok && sc.output.includes("out-of-order"),
      sc.output,
    );
  }

  // J4 — accepted ADR on a pull-request run: the branch carries the status,
  // the merge realizes it — trace is pending there, reconciled on main.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
    const m = JSON.parse(readText(root, "manifest.json"));
    m.adrs["0001-fixture"].status = "accepted";
    write(root, "manifest.json", `${JSON.stringify(m, null, 2)}\n`);
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
    const m = JSON.parse(readText(root, "manifest.json"));
    (m.adrs["0001-fixture"] as Record<string, unknown>).approved_by = "someone";
    write(root, "manifest.json", `${JSON.stringify(m, null, 2)}\n`);
    write(
      root,
      "iterations/0001-fixture/scores.json",
      SCORES.replace(
        '"deterministic_gate": "pass"',
        '"approved_by": "someone",\n  "deterministic_gate": "pass"',
      ),
    );
    const ms = run(root, "manifest-sync.ts");
    const sc = run(root, "scores-check.ts");
    expect(
      "legacy approved_by in ADR/manifest is rejected",
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
    write(root, "checks/test.ts", "");
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
process.exit(failed > 0 ? 1 : 0);
