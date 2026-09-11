// Selftest: verifies that Teddy's deterministic checks fail on broken trees
// and pass on valid ones. Runs each check as a subprocess against throwaway
// fixture trees — real git repositories, since merge traceability is part of
// the gates (adr/0003: merge = approval).
// Usage: node checks/selftest.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
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
    env: { ...process.env, ...env },
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

const RUBRIC = `version: 1
criteria:
  - id: adr-traceability
    description: Every accepted ADR has >=1 linked assertion or criterion
    weight: 2
    judge: manifest-sync
  - id: cockpit-clarity
    description: Dashboard is clear
    weight: 1
    judge: llm
adrs:
  0001-fixture:
    criteria: [adr-traceability]
`;

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
      "baseline": null,
      "status": "open"
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
pr: null
---
`;

const SCORES = `{
  "iteration": "0001-fixture",
  "ticket": "0001",
  "baseline": null,
  "timestamp": "2026-09-11T00:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "manifest-sync", "rationale": "ok" },
    "cockpit-clarity": { "score": null, "judge": "llm", "rationale": "not exercised" }
  },
  "overall": 1,
  "deterministic_gate": "pass"
}
`;

// Second iteration variants layered on the valid base. Under the adr/0001
// amended gate (paired per-criterion non-regression) F1 must fail and F2
// must pass.
const SCORES_0002 = `{
  "iteration": "0002-fixture",
  "ticket": "0002",
  "baseline": "0001-fixture",
  "timestamp": "2026-09-11T01:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "manifest-sync", "rationale": "ok" },
    "cockpit-clarity": { "score": 0, "judge": "llm", "rationale": "worse" }
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
    "adr-traceability": { "score": 0.5, "judge": "manifest-sync", "rationale": "regressed" },
    "cockpit-clarity": { "score": 1, "judge": "llm", "rationale": "improved" }
  },
  "overall": 0.6666666666666666,
  "deterministic_gate": "pass"
}
`;

const TICKET_0002 = `---
id: 0002
type: feature
goal: Fixture iteration two.
constraint: each exercised criterion must not decrease against its last recorded score
adr_refs: [0001]
pr: null
---
`;

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "teddy-selftest-"));
  write(root, "rubrics/rubric.yaml", RUBRIC);
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
    status: "open",
  });
  write(root, "manifest-of-iterations.json", JSON.stringify(entries, null, 2) + "\n");
}

// Land the accepted ADR (and mirrored manifest status) via a true merge
// commit — the only acceptance path under adr/0003.
function acceptViaMerge(root: string, withManifest = true): void {
  gitc(root, "checkout", "-qb", "feat");
  write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
  if (withManifest) {
    const m = JSON.parse(readText(root, "manifest.json"));
    m.adrs["0001-fixture"].status = "accepted";
    write(root, "manifest.json", JSON.stringify(m, null, 2) + "\n");
  }
  gitc(root, "add", "-A");
  gitc(root, "commit", "-qm", "accept 0001");
  gitc(root, "checkout", "-q", "main");
  gitc(root, "merge", "-q", "--no-ff", "feat", "-m", "Merge pull request #9 from t/feat");
}

function setRegistryStatus(root: string, id: string, status: string): void {
  const entries = JSON.parse(readText(root, "manifest-of-iterations.json"));
  const it = entries.iterations.find((e: { id: string }) => e.id === id);
  it.status = status;
  write(root, "manifest-of-iterations.json", JSON.stringify(entries, null, 2) + "\n");
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
    const rep = run(root, "cockpit-report.ts");
    const repCheck = run(root, "cockpit-report.ts", "--check");
    expect("valid tree: manifest-sync passes", ms.ok, ms.output);
    expect("valid tree: scores-check passes", sc.ok, sc.output);
    expect("valid tree: cockpit-report writes data.js", rep.ok, rep.output);
    expect("valid tree: cockpit-report --check passes", repCheck.ok, repCheck.output);
  }

  // B' — accepted ADR landed as a direct commit: no merge, no approval.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "adr/0001-fixture.md", ADR_ACCEPTED);
    const m = JSON.parse(readText(root, "manifest.json"));
    m.adrs["0001-fixture"].status = "accepted";
    write(root, "manifest.json", JSON.stringify(m, null, 2) + "\n");
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

  // D — manifest criteria drift against rubric.yaml.
  {
    const root = makeTree();
    roots.push(root);
    const manifest = JSON.parse(readText(root, "manifest.json"));
    manifest.adrs["0001-fixture"].criteria = ["adr-traceability", "cockpit-clarity"];
    write(root, "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
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

  // F1 — a criterion regresses against its last recorded score, even while a
  // different criterion improves: the per-criterion gate must reject (no masking).
  {
    const root = makeTree();
    roots.push(root);
    addIteration0002(root, SCORES_0002_REGRESSION);
    const sc = run(root, "scores-check.ts");
    expect(
      "per-criterion regression (even when compensated) is rejected",
      !sc.ok && sc.output.includes("per-criterion"),
      sc.output,
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

  // G — stale data.js: scores changed after data.js was generated.
  {
    const root = makeTree();
    roots.push(root);
    const rep = run(root, "cockpit-report.ts");
    expect("fixture: cockpit-report runs", rep.ok, rep.output);
    write(
      root,
      "iterations/0001-fixture/scores.json",
      SCORES.replace("not exercised", "not exercised yet"),
    );
    const stale = run(root, "cockpit-report.ts", "--check");
    expect(
      "stale data.js is rejected by --check",
      !stale.ok && stale.output.includes("stale"),
      stale.output,
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

  // J1 — registry 'closed' without a merge touching the iteration directory.
  {
    const root = makeTree();
    roots.push(root);
    setRegistryStatus(root, "0001-fixture", "closed");
    const sc = run(root, "scores-check.ts");
    expect(
      "closed iteration without merge trace is rejected",
      !sc.ok && sc.output.includes("merge commit"),
      sc.output,
    );
  }

  // J2 — closed via a true merge commit: must pass.
  {
    const root = makeTree();
    roots.push(root);
    gitc(root, "checkout", "-qb", "feat");
    write(
      root,
      "iterations/0001-fixture/scores.json",
      SCORES.replace("not exercised", "not exercised yet"),
    );
    setRegistryStatus(root, "0001-fixture", "closed");
    gitc(root, "add", "-A");
    gitc(root, "commit", "-qm", "close 0001");
    gitc(root, "checkout", "-q", "main");
    gitc(root, "merge", "-q", "--no-ff", "feat", "-m", "Merge pull request #10 from t/close");
    const sc = run(root, "scores-check.ts");
    expect("closed iteration with merge trace passes", sc.ok, sc.output);
  }

  // J3 — closed on a PR branch: the carrying merge does not exist yet, so the
  // trace reconciliation defers to main (github events only; local stays strict).
  {
    const root = makeTree();
    roots.push(root);
    setRegistryStatus(root, "0001-fixture", "closed");
    const sc = runEnv(root, { GITHUB_EVENT_NAME: "pull_request" }, "scores-check.ts");
    expect("closed iteration on a PR branch defers trace to main", sc.ok, sc.output);
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
    (m.adrs["0001-fixture"] as Record<string, unknown>)["approved_by"] = "someone";
    write(root, "manifest.json", JSON.stringify(m, null, 2) + "\n");
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
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log(`\nselftest: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
