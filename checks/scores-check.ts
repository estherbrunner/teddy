// Deterministic gate over iterations/*/scores.json + tickets + the iteration
// registry: schema integrity, weighted-aggregation correctness, and the
// per-criterion baseline gate (score must not decrease — fails closed).
// Usage: node checks/scores-check.ts [root]
// Exit 0 = consistent, 1 = failures listed below.
import { basename, dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
  exists,
  isGitRepo,
  mergeTrace,
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
  if ("approved_by" in scores) {
    fail(`${rel}: legacy field 'approved_by' — removed by adr/0003 (closure is scribe-owned)`);
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
}

// Baseline gate (adr/0001, amended by iteration 0003): paired per-criterion
// non-regression. Every non-null criterion must be ≥ its last recorded
// non-null score anywhere in the baseline chain; criteria exercised for the
// first time have no prior and pass. `overall` is the reported weighted
// aggregate — not gated — because iterations exercising different criteria
// sets are not comparable through it. Fails closed.
function latestPrior(
  criterionId: string,
  entry: IterationEntry,
): { score: number; from: string } | null {
  let cursor = entry.baseline;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const prev = byId.get(cursor);
    if (!prev) return null;
    const prevScores = scoresById.get(prev.id);
    const s = prevScores?.criteria[criterionId]?.score;
    if (typeof s === "number") return { score: s, from: prev.id };
    cursor = prev.baseline;
  }
  return null;
}

for (const entry of registry.iterations) {
  const scores = scoresById.get(entry.id);
  if (!scores || entry.baseline === null) continue;
  if (!byId.has(entry.baseline)) continue; // already failed above
  for (const [id, c] of Object.entries(scores.criteria)) {
    if (c.score === null) continue;
    const prior = latestPrior(id, entry);
    if (prior && c.score < prior.score) {
      fail(
        `${entry.scores}: per-criterion regression: '${id}' scored ${c.score} < last recorded ` +
          `${prior.score} (${prior.from}) — score must not decrease (adr/0001, amended)`,
      );
    }
  }
}

// Closure gates (adr/0003): 'closed' is scribe-owned — it must trace to a
// true merge commit touching the iteration directory (merge = approval), and
// the baseline chain must close in order. On pull-request runs the carrying
// merge does not exist yet (the scribe writes closure to the branch and the
// merge carries it), so trace reconciliation defers to main.
const pendingMergeContext = process.env.GITHUB_EVENT_NAME === "pull_request";
for (const entry of registry.iterations) {
  if (entry.status !== "closed") continue;
  if (entry.baseline !== null) {
    const baseEntry = byId.get(entry.baseline);
    if (baseEntry && baseEntry.status !== "closed") {
      fail(`${entry.scores}: closed while baseline '${entry.baseline}' is still open`);
    }
  }
  if (!isGitRepo(root)) {
    fail(`${entry.scores}: cannot verify merge trace — not a git repository (adr/0003)`);
    continue;
  }
  const trace = mergeTrace(root, `iterations/${entry.id}`);
  if (!trace && pendingMergeContext) {
    console.log(`scores-check: '${entry.id}' closed pending merge — trace reconciled on main`);
    continue;
  }
  if (!trace) {
    fail(
      `${entry.scores}: registry 'closed' but no merge commit touches iterations/${entry.id} ` +
        `(merge = approval, adr/0003); squash/rebase merges defeat traceability`,
    );
  }
}

if (fails.length > 0) {
  for (const f of fails) console.error(`FAIL: ${f}`);
  console.error(`\nscores-check: ${fails.length} failure(s)`);
  process.exit(1);
}
console.log(`scores-check: OK (${registry.iterations.length} iterations)`);
