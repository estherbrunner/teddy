// Deterministic gate over iterations/*/scores.json + tickets + the iteration
// registry: schema integrity, weighted-aggregation correctness, evidence
// verification for open iterations (adr/0006: gates and signals are re-run
// and must agree with what was recorded; llm scores are bounded by their
// evidence), and the per-criterion baseline gate (fails closed).
// Usage: node checks/scores-check.ts [root]
// Exit 0 = consistent, 1 = failures listed below.
import { basename, dirname, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
  exists,
  isGitRepo,
  iterationStatus,
  loadRubric,
  parseFrontmatter,
  readJson,
  readText,
  RUBRIC_PATH,
  runCheck,
  weightedOverall,
  type CheckResult,
  type LoadedRubric,
  type RubricCriterion,
} from "./lib.ts";

const root = process.argv[2] ?? process.cwd();
const fails: string[] = [];
function fail(msg: string): void {
  fails.push(msg);
}

let rubric: LoadedRubric;
try {
  rubric = await loadRubric(root);
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
}

interface IterationEntry {
  id: string;
  ticket: string;
  scores: string;
  baseline: string | null;
}

interface ScoreEntry {
  score: number | null;
  judge: string;
  rationale: string;
  gates: Record<string, string>; // gate id → pass | skip (adr/0006 evidence)
  signals: Record<string, number>; // "check.metric" → value
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
  if ("status" in e) {
    fail(
      `manifest-of-iterations.json: '${e.id}' legacy field 'status' — removed by adr/0005 ` +
        `(closure is derived from merge history, never stored)`,
    );
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
    if (fm.id !== scores.ticket) {
      fail(`${entry.ticket}: id '${fm.id}' does not match scores ticket '${scores.ticket}'`);
    }
    const type = fm.type;
    if (typeof type !== "string" || !["feature", "bugfix", "skill", "decision", "refactor"].includes(type)) {
      fail(`${entry.ticket}: invalid type '${type}'`);
    }
    for (const key of ["goal", "constraint"] as const) {
      if (typeof fm[key] !== "string" || (fm[key] as string).length === 0) {
        fail(`${entry.ticket}: missing required field '${key}'`);
      }
    }
    if (!Array.isArray(fm.adr_refs)) fail(`${entry.ticket}: missing required field 'adr_refs'`);
    if ("pr" in fm) {
      fail(
        `${entry.ticket}: legacy field 'pr' — removed by adr/0005 (amended); the PR is read ` +
          `off the merge commit, never stored`,
      );
    }
  }

  // Criteria + aggregation.
  const keys = Object.keys(scores.criteria ?? {});
  if (keys.length === 0) fail(`${rel}: no criteria recorded`);
  let exercised = 0;
  for (const [id, c] of Object.entries(scores.criteria ?? {})) {
    const crit = rubric.byId[id];
    if (!crit) {
      fail(`${rel}: unknown criterion '${id}' (not in ${RUBRIC_PATH})`);
      continue;
    }
    if (c.score !== null && (typeof c.score !== "number" || c.score < 0 || c.score > 1)) {
      fail(`${rel}: criterion '${id}' score must be null or a number in [0, 1]`);
    }
    if (c.score !== null) exercised++;
    if (c.judge !== crit.judge) {
      fail(`${rel}: criterion '${id}' judge '${c.judge}' does not match ${RUBRIC_PATH} judge '${crit.judge}'`);
    }
    if (typeof c.rationale !== "string" || c.rationale.length === 0) {
      fail(`${rel}: criterion '${id}' missing rationale`);
    }
    if (!c.gates || typeof c.gates !== "object" || !c.signals || typeof c.signals !== "object") {
      fail(`${rel}: criterion '${id}' must record evidence: 'gates' and 'signals' objects (adr/0006)`);
      continue;
    }
    // Recorded evidence must match the rubric's declaration for the criterion.
    for (const g of crit.gates) {
      if (c.gates[g] !== "pass" && c.gates[g] !== "skip") {
        fail(`${rel}: criterion '${id}' gate '${g}' must be recorded as pass | skip`);
      }
    }
    for (const g of Object.keys(c.gates)) {
      if (!crit.gates.includes(g)) fail(`${rel}: criterion '${id}' records gate '${g}' the rubric does not declare`);
    }
    for (const sig of crit.signals) {
      const key = `${sig.check}.${sig.metric}`;
      const v = c.signals[key];
      if (v === undefined) continue; // unmeasured — bounded below
      if (typeof v !== "number") fail(`${rel}: criterion '${id}' signal '${key}' must be a number`);
      else if (sig.min !== undefined && v < sig.min) {
        fail(`${rel}: criterion '${id}' signal '${key}' ${v} < min ${sig.min} (threshold is a gate)`);
      } else if (sig.max !== undefined && v > sig.max) {
        fail(`${rel}: criterion '${id}' signal '${key}' ${v} > max ${sig.max} (threshold is a gate)`);
      }
    }
    for (const key of Object.keys(c.signals)) {
      if (!crit.signals.some((sg) => `${sg.check}.${sg.metric}` === key)) {
        fail(`${rel}: criterion '${id}' records signal '${key}' the rubric does not declare`);
      }
    }
    // Evidence bounds (adr/0006).
    const skipped = crit.gates.some((g) => c.gates[g] === "skip") ||
      crit.signals.some((sg) => c.signals[`${sg.check}.${sg.metric}`] === undefined);
    if (crit.judge === "none") {
      if (c.score !== null && skipped) {
        fail(`${rel}: criterion '${id}' (judge none) has skipped evidence — score must be null, not ${c.score}`);
      } else if (c.score !== null && c.score !== 1) {
        fail(`${rel}: criterion '${id}' (judge none) score must be 1 when its evidence passed, got ${c.score}`);
      } else if (c.score === null && !skipped && (crit.gates.length > 0 || crit.signals.length > 0)) {
        fail(`${rel}: criterion '${id}' (judge none) has complete passing evidence — score must be 1, not null`);
      }
    } else if (c.score !== null && c.score > 0.5) {
      if (skipped) {
        fail(`${rel}: criterion '${id}' scored ${c.score} with skipped/unmeasured evidence — capped at 0.5 (adr/0006)`);
      } else if (crit.gates.length === 0 && crit.signals.length === 0 && !/[\w./-]+\.[a-z]{2,5}\b/.test(c.rationale ?? "")) {
        fail(`${rel}: criterion '${id}' scored ${c.score} with no evidence and a rationale citing no file — capped at 0.5 (adr/0006)`);
      }
    }
  }
  if (exercised === 0) fail(`${rel}: every criterion is null — nothing was exercised`);

  const computed = weightedOverall(scores.criteria, rubric);
  if (computed !== null && Math.abs(computed - scores.overall) > 1e-6) {
    fail(
      `${rel}: overall ${scores.overall} != weighted ${Number(computed.toFixed(6))} ` +
        `(weights from ${RUBRIC_PATH}, non-null criteria only)`,
    );
  }
}

// Evidence verification (adr/0006): for every open iteration — the one(s)
// under review on this ref — re-run each declared gate and signal against
// the tree and require the recorded evidence to agree. Closed iterations
// were verified on their PR run; their tree no longer exists.
const verifyEvidence = isGitRepo(root);
const checkCache = new Map<string, CheckResult>();
function measured(id: string): CheckResult {
  let r = checkCache.get(id);
  if (!r) {
    r = runCheck(root, id);
    checkCache.set(id, r);
  }
  return r;
}
if (verifyEvidence) {
  for (const entry of registry.iterations) {
    const scores = scoresById.get(entry.id);
    if (!scores || iterationStatus(root, entry.id) !== "open") continue;
    for (const [id, c] of Object.entries(scores.criteria)) {
      const crit: RubricCriterion | undefined = rubric.byId[id];
      if (!crit || !c.gates || !c.signals) continue;
      for (const g of crit.gates) {
        const actual = measured(g).verdict;
        if (actual === "fail") fail(`${entry.scores}: gate '${g}' fails on this tree (recorded ${c.gates[g]})`);
        else if (c.gates[g] !== actual) {
          fail(`${entry.scores}: gate '${g}' recorded ${c.gates[g]} but measures ${actual}`);
        }
      }
      for (const sig of crit.signals) {
        const key = `${sig.check}.${sig.metric}`;
        const m = measured(sig.check);
        if (m.verdict === "fail") {
          fail(`${entry.scores}: signal check '${sig.check}' fails on this tree`);
          continue;
        }
        const actual = m.signals[sig.metric];
        const recorded = c.signals[key];
        if (actual === undefined && recorded !== undefined) {
          fail(`${entry.scores}: signal '${key}' recorded ${recorded} but is unmeasured on this tree`);
        } else if (actual !== undefined && (recorded === undefined || Math.abs(actual - recorded) > 1e-6)) {
          fail(`${entry.scores}: signal '${key}' recorded ${String(recorded)} but measures ${actual}`);
        }
      }
    }
  }
}

// Baseline gate (adr/0001, amended by iteration 0003 and adr/0006): paired
// per-criterion non-regression against the last recorded value anywhere in
// the baseline chain. judge "none" scores are strict; judge "llm" scores may
// drop by at most the rubric's tolerance; ratchet signals are strict.
// Criteria/signals recorded for the first time have no prior and pass.
// `overall` is the reported weighted aggregate — not gated — because
// iterations exercising different criteria sets are not comparable through
// it. Fails closed.
function latestPrior(
  entry: IterationEntry,
  pick: (s: Scores) => number | null | undefined,
): { value: number; from: string } | null {
  let cursor = entry.baseline;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const prev = byId.get(cursor);
    if (!prev) return null;
    const prevScores = scoresById.get(prev.id);
    const v = prevScores ? pick(prevScores) : undefined;
    if (typeof v === "number") return { value: v, from: prev.id };
    cursor = prev.baseline;
  }
  return null;
}

for (const entry of registry.iterations) {
  const scores = scoresById.get(entry.id);
  if (!scores || entry.baseline === null) continue;
  if (!byId.has(entry.baseline)) continue; // already failed above
  for (const [id, c] of Object.entries(scores.criteria)) {
    const crit = rubric.byId[id];
    if (!crit) continue;
    if (c.score !== null) {
      const prior = latestPrior(entry, (s) => s.criteria[id]?.score);
      const slack = crit.judge === "llm" ? rubric.tolerance : 0;
      if (prior && c.score < prior.value - slack - 1e-9) {
        fail(
          `${entry.scores}: per-criterion regression: '${id}' scored ${c.score} < last recorded ` +
            `${prior.value} (${prior.from})${slack > 0 ? ` − tolerance ${slack}` : ""} (adr/0001, amended; adr/0006)`,
        );
      }
    }
    for (const sig of crit.signals) {
      if (!sig.ratchet) continue;
      const key = `${sig.check}.${sig.metric}`;
      const v = c.signals?.[key];
      if (typeof v !== "number") continue;
      const prior = latestPrior(entry, (s) => s.criteria[id]?.signals?.[key]);
      if (prior && v < prior.value - 1e-9) {
        fail(
          `${entry.scores}: signal regression: '${id}' ${key} ${v} < last recorded ${prior.value} ` +
            `(${prior.from}) — ratchet signal may not decrease (adr/0006)`,
        );
      }
    }
  }
}

// Closure order (adr/0003, adr/0005): closure is derived — an iteration is
// closed iff a merge commit touches its directory — so there is nothing to
// reconcile, only order to enforce: a closed iteration whose baseline is
// still open means an out-of-order or squash/rebase merge, which defeats
// the baseline chain.
if (!isGitRepo(root)) {
  fail("cannot derive iteration closure — not a git repository (adr/0003, adr/0005)");
} else {
  for (const entry of registry.iterations) {
    if (entry.baseline === null || !byId.has(entry.baseline)) continue;
    if (iterationStatus(root, entry.id) === "closed" && iterationStatus(root, entry.baseline) === "open") {
      fail(
        `${entry.scores}: closed (merged) while baseline '${entry.baseline}' is still open — ` +
          `out-of-order merge, or the baseline's PR was squash/rebase-merged (adr/0003)`,
      );
    }
  }
}

if (fails.length > 0) {
  for (const f of fails) console.error(`FAIL: ${f}`);
  console.error(`\nscores-check: ${fails.length} failure(s)`);
  process.exit(1);
}
console.log(`scores-check: OK (${registry.iterations.length} iterations)`);
