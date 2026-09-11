// Selftest: verifies that Teddy's deterministic checks fail on broken trees
// and pass on a valid one. Runs each check as a subprocess against throwaway
// fixture trees, so the checks are exercised exactly as CI and agents run them.
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

function run(root: string, script: string, ...args: string[]): SpawnResult {
  const res = spawnSync(process.execPath, [join(checksDir, script), ...args, root], {
    encoding: "utf8",
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

const ADR = `---
id: 0001
status: proposed
supersedes: null
superseded_by: null
approved_by: null
rubric_refs: [adr-traceability]
---

# 0001 — Fixture
`;

const MANIFEST = `{
  "version": 1,
  "adrs": {
    "0001-fixture": {
      "status": "proposed",
      "approved_by": null,
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
constraint: score must not decrease (baseline: none)
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
  "deterministic_gate": "pass",
  "approved_by": null
}
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
  return root;
}

// Second iteration added on top of the valid base: overall 2/3 < baseline 1.
const SCORES_0002 = `{
  "iteration": "0002-fixture",
  "ticket": "0002",
  "baseline": "0001-fixture",
  "timestamp": "2026-09-11T01:00:00Z",
  "criteria": {
    "adr-traceability": { "score": 1, "judge": "manifest-sync", "rationale": "ok" },
    "cockpit-clarity": { "score": 0, "judge": "llm", "rationale": "worse" }
  },
  "overall": 0.667,
  "deterministic_gate": "pass",
  "approved_by": null
}
`;

const TICKET_0002 = `---
id: 0002
type: feature
goal: Fixture iteration two.
constraint: score must not decrease (baseline: iterations/0001-fixture/scores.json)
adr_refs: [0001]
pr: null
---
`;

function addIteration0002(root: string): void {
  write(root, "iterations/0002-fixture/ticket.md", TICKET_0002);
  write(root, "iterations/0002-fixture/scores.json", SCORES_0002);
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

function readText(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
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

  // B — ADR accepted without approval: lifecycle gate must reject.
  {
    const root = makeTree();
    roots.push(root);
    write(root, "adr/0001-fixture.md", ADR.replace("status: proposed", "status: accepted"));
    const ms = run(root, "manifest-sync.ts");
    expect(
      "accepted ADR with null approved_by is rejected",
      !ms.ok && ms.output.includes("approved_by"),
      ms.output,
    );
  }

  // H — ADR accepted WITH approval, manifest mirrors it: gate must allow.
  {
    const root = makeTree();
    roots.push(root);
    write(
      root,
      "adr/0001-fixture.md",
      ADR.replace("status: proposed", "status: accepted").replace(
        "approved_by: null",
        'approved_by: "estherbrunner"',
      ),
    );
    const manifest = JSON.parse(readText(root, "manifest.json"));
    manifest.adrs["0001-fixture"].status = "accepted";
    manifest.adrs["0001-fixture"].approved_by = "estherbrunner";
    write(root, "manifest.json", JSON.stringify(manifest, null, 2) + "\n");
    const ms = run(root, "manifest-sync.ts");
    expect("accepted ADR with approval passes gate", ms.ok, ms.output);
  }

  // I — --fix resolves status drift and must exit clean, not report
  // the pre-fix failures.
  {
    const root = makeTree();
    roots.push(root);
    write(
      root,
      "adr/0001-fixture.md",
      ADR.replace("status: proposed", "status: accepted").replace(
        "approved_by: null",
        'approved_by: "estherbrunner"',
      ),
    );
    const first = run(root, "manifest-sync.ts", "--fix");
    expect("manifest-sync --fix syncs drift and exits 0", first.ok, first.output);
    const second = run(root, "manifest-sync.ts");
    expect("manifest-sync passes after --fix", second.ok, second.output);
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

  // F — iteration scores below its baseline: gate fails closed.
  {
    const root = makeTree();
    roots.push(root);
    addIteration0002(root);
    const sc = run(root, "scores-check.ts");
    expect(
      "overall below baseline is rejected",
      !sc.ok && sc.output.includes("baseline"),
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
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log(`\nselftest: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
