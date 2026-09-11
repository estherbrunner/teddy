// Deterministic gate over iterations/*/scores.json + tickets + the iteration
// registry: schema integrity, weighted-aggregation correctness, and the
// baseline gate (score must not decrease — fails closed).
// Usage: node checks/scores-check.ts [root]
// Exit 0 = consistent, 1 = failures listed below.
import { basename, dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
  exists,
  parseFrontmatter,
  parseRubric,
  readJson,
  readText,
  weightedOverall,
} from "./lib.ts";

const root = process.argv[2] ?? process.cwd();
const fails: string[] = [];
function fail(msg: string): void {
  fails.push(msg);
}

let rubric;
try {
  rubric = parseRubric(readText(root, "rubrics/rubric.yaml"));
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
}

interface IterationEntry {
  id: string;
  ticket: string;
  scores: string;
  baseline: string | null;
  status: string;
}

interface ScoreEntry {
  score: number | null;
  judge: string;
  rationale: string;
}

interface Scores {
  iteration: string;
  ticket: string;
  baseline: string | null;
  timestamp: string;
  criteria: Record<string, ScoreEntry>;
  overall: number;
  deterministic_gate: string;
  approved_by: string | null;
}

const registry = readJson<{ version: number; iterations: IterationEntry[] }>(
  root,
  "manifest-of-iterations.json",
);
const byId = new Map<string, IterationEntry>();
for (const e of registry.iterations) {
  if (byId.has(e.id)) fail(`manifest-of-iterations.json: duplicate iteration '${e.id}'`);
  byId.set(e.id, e);
}
for (const e of registry.iterations) {
  if (e.baseline !== null && !byId.has(e.baseline)) {
    fail(`manifest-of-iterations.json: '${e.id}' baseline '${e.baseline}' does not resolve`);
  }
  if (!exists(root, e.ticket)) fail(`manifest-of-iterations.json: '${e.id}' ticket missing: ${e.ticket}`);
  if (!exists(root, e.scores)) fail(`manifest-of-iterations.json: '${e.id}' scores missing: ${e.scores}`);
  if (e.status !== "open" && e.status !== "closed") {
    fail(`manifest-of-iterations.json: '${e.id}' invalid status '${e.status}' (open | closed)`);
  }
}

// Also catch iteration directories that exist on disk but are not registered.
const iterDir = join(root, "iterations");
const onDisk = existsSync(iterDir)
  ? readdirSync(iterDir).filter((d) => !d.startsWith("."))
  : [];
for (const d of onDisk) {
  if (!byId.has(d)) fail(`iterations/${d}: not registered in manifest-of-iterations.json`);
  else if (!/^\d{4}-[a-z0-9-]+$/.test(d)) {
    fail(`iterations/${d}: directory name must match NNNN-slug`);
  }
}

const scoresById = new Map<string, Scores>();
for (const entry of registry.iterations) {
  if (!exists(root, entry.scores)) continue;
  let scores: Scores;
  try {
    scores = readJson<Scores>(root, entry.scores);
  } catch (err) {
    fail(`${entry.scores}: invalid JSON (${(err as Error).message})`);
    continue;
  }
  scoresById.set(entry.id, scores);
  const rel = entry.scores;
  const dirName = basename(dirname(rel));

  if (scores.iteration !== entry.id) {
    fail(`${rel}: 'iteration' '${scores.iteration}' does not match registry id '${entry.id}'`);
  }
  if (!/^\d{4}-[a-z0-9-]+$/.test(dirName) || dirName !== entry.id) {
    fail(`${rel}: must live in iterations/${entry.id}/`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(scores.timestamp))) {
    fail(`${rel}: 'timestamp' must be ISO-8601`);
  }
  if (scores.deterministic_gate !== "pass") {
    fail(`${rel}: 'deterministic_gate' must be 'pass' (raw tests/lints are a hard gate)`);
  }

  // Ticket cross-checks.
  if (exists(root, entry.ticket)) {
    const { fm } = parseFrontmatter(readText(root, entry.ticket), entry.ticket);
    if (fm["id"] !== scores.ticket) {
      fail(`${entry.ticket}: id '${fm["id"]}' does not match scores ticket '${scores.ticket}'`);
    }
    const type = fm["type"];
    if (typeof type !== "string" || !["feature", "bugfix", "skill", "decision", "refactor"].includes(type)) {
      fail(`${entry.ticket}: invalid type '${type}'`);
    }
    for (const key of ["goal", "constraint"] as const) {
      if (typeof fm[key] !== "string" || (fm[key] as string).length === 0) {
        fail(`${entry.ticket}: missing required field '${key}'`);
      }
    }
    if (!Array.isArray(fm["adr_refs"])) fail(`${entry.ticket}: missing required field 'adr_refs'`);
    if (!("pr" in fm)) fail(`${entry.ticket}: missing required field 'pr' (null until the PR opens)`);
  }

  // Criteria + aggregation.
  const keys = Object.keys(scores.criteria ?? {});
  if (keys.length === 0) fail(`${rel}: no criteria recorded`);
  let exercised = 0;
  for (const [id, c] of Object.entries(scores.criteria ?? {})) {
    if (!rubric.criteria[id]) {
      fail(`${rel}: unknown criterion '${id}' (not in rubric.yaml)`);
      continue;
    }
    if (c.score !== null && (typeof c.score !== "number" || c.score < 0 || c.score > 1)) {
      fail(`${rel}: criterion '${id}' score must be null or a number in [0, 1]`);
    }
    if (c.score !== null) exercised++;
    if (c.judge !== rubric.criteria[id].judge) {
      fail(
        `${rel}: criterion '${id}' judge '${c.judge}' does not match rubric.yaml judge ` +
          `'${rubric.criteria[id].judge}'`,
      );
    }
    if (typeof c.rationale !== "string" || c.rationale.length === 0) {
      fail(`${rel}: criterion '${id}' missing rationale`);
    }
  }
  if (exercised === 0) fail(`${rel}: every criterion is null — nothing was exercised`);

  const computed = weightedOverall(scores.criteria, rubric);
  if (computed !== null && Math.abs(computed - scores.overall) > 1e-6) {
    fail(
      `${rel}: overall ${scores.overall} != weighted ${Number(computed.toFixed(6))} ` +
        `(weights from rubric.yaml, non-null criteria only)`,
    );
  }

  // Human gate mirrors the ADR lifecycle: approved_by ⇔ closed.
  if (scores.approved_by === null && entry.status !== "open") {
    fail(`${rel}: approved_by is null but registry status is '${entry.status}' (must be 'open')`);
  }
  if (scores.approved_by !== null && entry.status !== "closed") {
    fail(`${rel}: approved_by set but registry status is '${entry.status}' (must be 'closed')`);
  }
}

// Baseline gate: fails closed.
for (const entry of registry.iterations) {
  const scores = scoresById.get(entry.id);
  if (!scores || entry.baseline === null) continue;
  const baseScores = scoresById.get(entry.baseline);
  if (!baseScores) {
    fail(`${entry.scores}: baseline '${entry.baseline}' has no readable scores.json`);
    continue;
  }
  if (scores.approved_by !== null && baseScores.approved_by === null) {
    fail(`${entry.scores}: cannot be closed while baseline '${entry.baseline}' is unapproved`);
  }
  if (scores.overall < baseScores.overall) {
    fail(
      `${entry.scores}: overall ${scores.overall} < baseline ${baseScores.overall} ` +
        `(${entry.baseline}) — score must not decrease`,
    );
  }
}

if (fails.length > 0) {
  for (const f of fails) console.error(`FAIL: ${f}`);
  console.error(`\nscores-check: ${fails.length} failure(s)`);
  process.exit(1);
}
console.log(`scores-check: OK (${registry.iterations.length} iterations)`);
