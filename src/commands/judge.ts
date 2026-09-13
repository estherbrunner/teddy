// `teddy judge` (adr/0006): scores the open iteration on this branch and
// writes its scores.json. Deterministic first — every gate and signal is
// measured and recorded; judge "none" criteria are scored by rule. What
// remains — judge "llm" criteria — is scored by a model against the rubric's
// anchors with the evidence bundle (ticket, diff against the merge base,
// gate verdicts, signal values), then bounded by that evidence. The LLM judge
// runs locally, on demand, never in CI; CI verifies the evidence
// (scores-check). Without a credential the llm criteria stay null.
//
// Usage: teddy judge [--verify | --dry-run] [--iteration <id>] [root]
//   --verify    re-judge and compare against the recorded scores.json:
//               deterministic parts must match, an llm score may not exceed
//               the fresh one by more than the rubric's tolerance; writes nothing
//   --dry-run   print the scores.json that would be written; writes nothing
// Env: ANTHROPIC_API_KEY, TEDDY_JUDGE_MODEL (default claude-opus-5),
//      TEDDY_JUDGE_URL (default https://api.anthropic.com/v1/messages; a
//      file:// URL replays a recorded response instead of calling out —
//      the deterministic seam the selftest uses where it cannot listen)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  exists,
  isGitRepo,
  listIterations,
  loadConfig,
  readJson,
  readText,
  runCheck,
  trunkRef,
  writeText,
  type CheckResult,
  type ResolvedConfig,
  type RubricCriterion,
} from "../lib.ts";

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const dryRun = args.includes("--dry-run");
const iterArg = args.includes("--iteration") ? args[args.indexOf("--iteration") + 1] : undefined;
const root = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--iteration")[0] ?? process.cwd();

if (!isGitRepo(root)) {
  console.error("FAIL: judge: not a git repository");
  process.exit(1);
}
const cfg: ResolvedConfig = await loadConfig(root);
const rubric = cfg.rubric;

// --- the iteration under judgment -------------------------------------------
const open = listIterations(root, cfg).filter((it) => it.status === "open" && !it.onTrunk);
const found = iterArg ? open.find((it) => it.id === iterArg) : open[open.length - 1];
if (!found) {
  console.error(
    iterArg
      ? `FAIL: judge: '${iterArg}' is not an open iteration on this branch`
      : "FAIL: judge: no open iteration on this branch — scaffold one first (iteration-scaffold)",
  );
  process.exit(1);
}
const target = found;
if (open.length > 1 && !iterArg) console.error(`judge: ${open.length} open iterations — judging the latest, '${target.id}' (use --iteration)`);

// --- evidence ----------------------------------------------------------------
const cache = new Map<string, CheckResult>();
const measured = (id: string): CheckResult => {
  let r = cache.get(id);
  if (!r) {
    r = runCheck(root, cfg, id);
    cache.set(id, r);
  }
  return r;
};

interface Entry {
  score: number | null;
  judge: "llm" | "none";
  rationale: string;
  gates: Record<string, "pass" | "skip">;
  signals: Record<string, number>;
}
const entries: Record<string, Entry> = {};
const failing: string[] = [];
for (const crit of rubric.criteria) {
  const gates: Record<string, "pass" | "skip"> = {};
  const signals: Record<string, number> = {};
  const skipped: string[] = [];
  for (const g of crit.gates) {
    const v = measured(g).verdict;
    if (v === "fail") failing.push(`${crit.id}: gate '${g}' fails`);
    else {
      gates[g] = v;
      if (v === "skip") skipped.push(`gate ${g} skipped`);
    }
  }
  for (const sig of crit.signals) {
    const m = measured(sig.check);
    const key = `${sig.check}.${sig.metric}`;
    if (m.verdict === "fail") {
      failing.push(`${crit.id}: signal check '${sig.check}' fails`);
      continue;
    }
    const v = m.signals[sig.metric];
    if (v === undefined) skipped.push(`signal ${key} unmeasured`);
    else {
      signals[key] = v;
      if (sig.min !== undefined && v < sig.min) failing.push(`${crit.id}: ${key} ${v} < min ${sig.min}`);
      if (sig.max !== undefined && v > sig.max) failing.push(`${crit.id}: ${key} ${v} > max ${sig.max}`);
    }
  }
  const evidence = crit.gates.length + crit.signals.length;
  entries[crit.id] = {
    score: crit.judge === "none" ? (evidence > 0 && skipped.length === 0 ? 1 : null) : null,
    judge: crit.judge,
    rationale:
      crit.judge === "none"
        ? evidence === 0
          ? "not exercised — no gates or signals declared"
          : skipped.length === 0
            ? `deterministic: ${[...crit.gates.map((g) => `gate ${g} pass`), ...Object.entries(signals).map(([k, v]) => `${k} = ${v}`)].join(", ")}`
            : `not measurable: ${skipped.join(", ")}`
        : "not judged",
    gates,
    signals,
  };
  if (crit.judge === "llm" && skipped.length > 0) entries[crit.id].rationale = `not judged; evidence incomplete: ${skipped.join(", ")}`;
}
if (failing.length > 0) {
  for (const f of failing) console.error(`FAIL: judge: ${f}`);
  console.error("judge: fix the failing gates before judging — a failing gate blocks the PR regardless of score");
  process.exit(1);
}

// --- the LLM residue ----------------------------------------------------------
const llmCriteria = rubric.criteria.filter((c) => c.judge === "llm");
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.TEDDY_JUDGE_MODEL ?? "claude-opus-5";
const url = process.env.TEDDY_JUDGE_URL ?? "https://api.anthropic.com/v1/messages";

function evidenceBundle(): string {
  const trunk = trunkRef(root, cfg.main);
  const base = trunk ? spawnSync("git", ["-C", root, "merge-base", trunk, "HEAD"], { encoding: "utf8" }).stdout.trim() : "";
  const range = base ? `${base}..HEAD` : "HEAD~1..HEAD";
  const diff = spawnSync("git", ["-C", root, "diff", range, "--", ...cfg.src, target.dir, cfg.dirs.adr], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
  const ticket = exists(root, target.ticket) ? readText(root, target.ticket) : "(no ticket)";
  const measuredOut = [...cache.values()]
    .map((r) => `${r.id}: ${r.verdict}${Object.keys(r.signals).length ? ` ${JSON.stringify(r.signals)}` : ""}`)
    .join("\n");
  return [
    `# Iteration ${target.id} (baseline: ${target.baseline ?? "none"})`,
    "",
    "## Ticket",
    ticket.trim(),
    "",
    "## Deterministic evidence (measured now)",
    measuredOut || "(none declared)",
    "",
    `## Diff (${range}, paths: ${cfg.src.join(" ")})`,
    "```diff",
    diff.length > 400_000 ? `${diff.slice(0, 400_000)}\n… (truncated: ${diff.length} bytes)` : diff,
    "```",
  ].join("\n");
}

function rubricText(criteria: RubricCriterion[]): string {
  return criteria
    .map((c) => {
      const a = c.anchors ?? { 0: "", 0.5: "", 1: "" };
      return [
        `### ${c.id} (weight ${c.weight})`,
        c.description,
        `- score 0: ${a[0]}`,
        `- score 0.5: ${a[0.5]}`,
        `- score 1: ${a[1]}`,
        c.gates.length || c.signals.length
          ? `- declared evidence: ${[...c.gates, ...c.signals.map((s) => `${s.check}.${s.metric}`)].join(", ")}`
          : "- declared evidence: none — a score above 0.5 must cite a file",
      ].join("\n");
    })
    .join("\n\n");
}

const SYSTEM = `You are the rubric judge of an eval-driven development harness. You score an iteration's change against human-written criteria, each with anchors for 0, 0.5 and 1. Rules:
- Score against the anchors' words, not your own idea of quality. Any value in [0, 1] is allowed; the anchors calibrate it.
- A criterion the change does not touch is "not exercised": set exercised=false and give no score. Do not force a number onto untouched criteria.
- Every score needs a rationale that cites specific evidence: file paths, behaviour visible in the diff, gate verdicts, signal values. A reviewer must be able to check the number by reading the rationale.
- Never round up because the trend is right. Report what the evidence shows.`;

// Transport: the Anthropic Messages API over fetch (Teddy carries no
// runtime dependency, adr/0007), or a recorded response from a file:// URL.
async function postMessages(body: unknown): Promise<unknown> {
  if (url.startsWith("file://")) return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`judge: ${model} responded ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

interface Verdict {
  id: string;
  exercised: boolean;
  score: number | null;
  rationale: string;
}

async function callJudge(criteria: RubricCriterion[]): Promise<Verdict[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["criteria"],
    properties: {
      criteria: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "exercised", "score", "rationale"],
          properties: {
            id: { type: "string", enum: criteria.map((c) => c.id) },
            exercised: { type: "boolean" },
            score: { type: ["number", "null"], minimum: 0, maximum: 1 },
            rationale: { type: "string" },
          },
        },
      },
    },
  };
  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: `## Criteria\n\n${rubricText(criteria)}\n\n${evidenceBundle()}\n\nScore every criterion listed above.`,
      },
    ],
  };
  const msg = (await postMessages(body)) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    stop_details?: { explanation?: string };
  };
  if (msg.stop_reason === "refusal") throw new Error(`judge: model refused: ${msg.stop_details?.explanation ?? ""}`);
  if (msg.stop_reason === "max_tokens") throw new Error("judge: model output truncated (max_tokens)");
  const text = msg.content?.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { criteria: Verdict[] };
  return parsed.criteria;
}

const judgeable = llmCriteria.filter((c) => !entries[c.id].rationale.startsWith("not judged; evidence incomplete"));
if (judgeable.length > 0) {
  if (!apiKey) {
    console.error(`judge: no ANTHROPIC_API_KEY — ${judgeable.length} llm criteria left null (not judged)`);
    for (const c of judgeable) entries[c.id].rationale = "not judged — no judge credential in this environment";
    if (verify) {
      console.error("FAIL: judge --verify needs a credential to re-judge");
      process.exit(1);
    }
  } else {
    console.error(`judge: scoring ${judgeable.map((c) => c.id).join(", ")} with ${model}`);
    let verdicts: Verdict[];
    try {
      verdicts = await callJudge(judgeable);
    } catch (e) {
      console.error(`FAIL: ${(e as Error).message}`);
      process.exit(1);
    }
    for (const c of judgeable) {
      const v = verdicts.find((x) => x.id === c.id);
      const e = entries[c.id];
      if (!v?.exercised || v.score === null) {
        e.score = null;
        e.rationale = `not exercised — ${v?.rationale ?? "no verdict returned"}`;
        continue;
      }
      let score = Math.max(0, Math.min(1, v.score));
      // Evidence bounds (adr/0006) — the same rules scores-check enforces.
      const noEvidence = c.gates.length === 0 && c.signals.length === 0;
      if (noEvidence && score > 0.5 && !/[\w./-]+\.[a-z]{2,5}\b/.test(v.rationale)) {
        score = 0.5;
        e.rationale = `${v.rationale} [capped at 0.5: no declared evidence and no file cited]`;
      } else e.rationale = v.rationale;
      e.score = score;
    }
  }
}

// --- output ---------------------------------------------------------------------
const scores = { timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), criteria: entries };
const content = `${JSON.stringify(scores, null, 2)}\n`;

if (verify) {
  if (!exists(root, target.scores)) {
    console.error(`FAIL: judge --verify: ${target.scores} missing`);
    process.exit(1);
  }
  const recorded = readJson<{ criteria: Record<string, Entry> }>(root, target.scores);
  const problems: string[] = [];
  for (const crit of rubric.criteria) {
    const r = recorded.criteria[crit.id];
    const f = entries[crit.id];
    if (!r) {
      problems.push(`${crit.id}: not recorded`);
      continue;
    }
    if (JSON.stringify(r.gates ?? {}) !== JSON.stringify(f.gates) || JSON.stringify(r.signals ?? {}) !== JSON.stringify(f.signals)) {
      problems.push(`${crit.id}: recorded evidence differs from measurement`);
    }
    if (crit.judge === "none" && r.score !== f.score) problems.push(`${crit.id}: recorded ${r.score}, rule gives ${f.score}`);
    if (crit.judge === "llm" && r.score !== null && f.score !== null && r.score > f.score + rubric.tolerance + 1e-9) {
      problems.push(`${crit.id}: recorded ${r.score} exceeds fresh judgment ${f.score} by more than tolerance ${rubric.tolerance}`);
    }
    if (crit.judge === "llm" && r.score !== null && f.score === null) {
      problems.push(`${crit.id}: recorded ${r.score} but the fresh judgment finds it not exercised`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: judge --verify: ${p}`);
    process.exit(1);
  }
  console.log(`judge --verify: OK (${target.id}: recorded scores are within tolerance of a fresh judgment)`);
  process.exit(0);
}

if (dryRun) {
  process.stdout.write(content);
  process.exit(0);
}
writeText(root, target.scores, content);
const summary = Object.entries(entries)
  .map(([id, e]) => `${id}=${e.score === null ? "null" : e.score}`)
  .join(" ");
console.log(`judge: wrote ${target.scores} (${summary}) — run \`teddy scores-check\` to gate it`);
