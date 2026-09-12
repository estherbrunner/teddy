// Deterministic gate over iterations/*/{ticket.md,scores.json}: schema
// integrity, ticket cross-checks, evidence verification for open iterations
// (adr/0006: gates and signals are re-run and must agree with what was
// recorded; llm scores are bounded by their evidence), and the per-criterion
// baseline gate (fails closed). Iterations, their status, and their
// baseline are derived from the directory and git (adr/0005, adr/0007) —
// there is no registry.
// Usage: node scores-check.ts [--json] [root]
// Exit 0 = consistent, 1 = failures listed below.
import {
  emitResult,
  exists,
  isGitRepo,
  listIterations,
  loadConfig,
  parseFrontmatter,
  readJson,
  readText,
  runCheck,
  weightedOverall,
  type CheckResult,
  type Iteration,
  type ResolvedConfig,
  type RubricCriterion,
} from "../lib.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const log = (msg: string): void => (json ? console.error(msg) : console.log(msg));
const fails: string[] = [];
function fail(msg: string): void {
  fails.push(msg);
}

let cfg: ResolvedConfig;
try {
  cfg = await loadConfig(root);
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  emitResult("scores-check", "fail", json);
}
const rubric = cfg.rubric;

if (!isGitRepo(root)) {
  console.error("FAIL: cannot derive iterations — not a git repository (adr/0003, adr/0005)");
  emitResult("scores-check", "fail", json);
}

interface ScoreEntry {
  score: number | null;
  judge: string;
  rationale: string;
  gates: Record<string, string>; // gate id → pass | skip (adr/0006 evidence)
  signals: Record<string, number>; // "check.metric" → value
}

interface Scores {
  timestamp: string;
  criteria: Record<string, ScoreEntry>;
}

const LEGACY_SCORE_FIELDS = ["iteration", "ticket", "baseline", "overall", "deterministic_gate", "approved_by"];

const iterations = listIterations(root, cfg);
const byId = new Map<string, Iteration>(iterations.map((it) => [it.id, it]));
for (const it of iterations) {
  if (!cfg.pattern.test(it.id)) fail(`${it.dir}: directory name does not match pattern ${cfg.pattern}`);
  if (!exists(root, it.ticket)) fail(`${it.dir}: ticket.md missing`);
  if (!exists(root, it.scores)) fail(`${it.dir}: scores.json missing`);
  // An iteration directory on the trunk without a merge commit touching it
  // was squash/rebase-merged — closure cannot be derived (adr/0003, adr/0005).
  if (it.status === "open" && it.onTrunk) {
    fail(`${it.dir}: on the trunk but no merge commit touches it — squash/rebase merges defeat traceability`);
  }
}

const scoresById = new Map<string, Scores>();
for (const entry of iterations) {
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

  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(scores.timestamp))) {
    fail(`${rel}: 'timestamp' must be ISO-8601`);
  }
  for (const legacy of LEGACY_SCORE_FIELDS) {
    if (legacy in scores) {
      fail(`${rel}: legacy field '${legacy}' — derived from the directory, git, or the rubric; never stored (adr/0007)`);
    }
  }

  // Ticket cross-checks: the ticket id is the iteration's number.
  if (exists(root, entry.ticket)) {
    const { fm } = parseFrontmatter(readText(root, entry.ticket), entry.ticket);
    if (typeof fm.id !== "string" || !entry.id.startsWith(`${fm.id}-`)) {
      fail(`${entry.ticket}: id '${fm.id}' does not match directory '${entry.id}'`);
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
      fail(`${rel}: unknown criterion '${id}' (not in the rubric)`);
      continue;
    }
    if (c.score !== null && (typeof c.score !== "number" || c.score < 0 || c.score > 1)) {
      fail(`${rel}: criterion '${id}' score must be null or a number in [0, 1]`);
    }
    if (c.score !== null) exercised++;
    if (c.judge !== crit.judge) {
      fail(`${rel}: criterion '${id}' judge '${c.judge}' does not match the rubric's judge '${crit.judge}'`);
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

  // overall is derived (adr/0007) — computed here only to validate weights resolve.
  weightedOverall(scores.criteria, rubric);
}

// Evidence verification (adr/0006): for every open iteration — the one(s)
// under review on this ref — re-run each declared gate and signal against
// the tree and require the recorded evidence to agree. Closed iterations
// were verified on their PR run; their tree no longer exists.
const checkCache = new Map<string, CheckResult>();
function measured(id: string): CheckResult {
  let r = checkCache.get(id);
  if (!r) {
    r = runCheck(root, cfg, id);
    checkCache.set(id, r);
  }
  return r;
}
for (const entry of iterations) {
  const scores = scoresById.get(entry.id);
  if (!scores || entry.status !== "open") continue;
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

// Baseline gate (adr/0001, amended by iteration 0003 and adr/0006): paired
// per-criterion non-regression against the last recorded value anywhere in
// the baseline chain. judge "none" scores are strict; judge "llm" scores may
// drop by at most the rubric's tolerance; ratchet signals are strict.
// Criteria/signals recorded for the first time have no prior and pass.
// `overall` is the reported weighted aggregate — not gated — because
// iterations exercising different criteria sets are not comparable through
// it. Fails closed.
function latestPrior(
  entry: Iteration,
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

for (const entry of iterations) {
  const scores = scoresById.get(entry.id);
  if (!scores || entry.baseline === null) continue;
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

if (fails.length > 0) {
  for (const f of fails) console.error(`FAIL: ${f}`);
  console.error(`\nscores-check: ${fails.length} failure(s)`);
  emitResult("scores-check", "fail", json);
}
log(`scores-check: OK (${iterations.length} iterations)`);
emitResult("scores-check", "pass", json);
