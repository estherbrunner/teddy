// Shared parsing + aggregation helpers for Teddy's deterministic checks.
// Runs under Node's native type-stripping: erasable syntax only, ESM,
// relative imports must carry the .ts extension.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// Is `root` a git work tree? (adr/0003 gates are git-native; a harness run
// outside a repository cannot verify merge traceability.)
export function isGitRepo(root: string): boolean {
  return spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  }).status === 0;
}

// First-parent merge commits touching a path — the "which merged PR brought
// this change" query. Plain `git log -- path` silently hides merge commits
// whose content came from the second parent (history simplification).
// Newest first; `oldest` flips to the merge that introduced the path — the
// one that landed it, as opposed to the latest one that touched it.
export function mergeTrace(root: string, rel: string, oldest = false): string | null {
  const res = spawnSync(
    "git",
    ["-C", root, "log", "--first-parent", "--merges", "--format=%h %s", "--", rel],
    { encoding: "utf8" },
  );
  if (res.status !== 0) return null;
  const lines = res.stdout.trim().split("\n");
  const line = oldest ? lines[lines.length - 1] : lines[0];
  return line === "" ? null : line;
}

// The pull request that landed a path, read off the subject of the oldest
// merge commit touching it ("Merge pull request #N from …") — GitHub writes
// it, nobody stores it (adr/0005, amended). Null while unmerged or when the
// subject was rewritten.
export function mergedPr(root: string, rel: string): number | null {
  const m = mergeTrace(root, rel, true)?.match(/Merge pull request #(\d+)\b/);
  return m ? Number(m[1]) : null;
}

// Iteration closure is defined, not recorded (adr/0005): an iteration is
// closed iff a first-parent merge commit touches its directory on the
// current ref — i.e. its PR was merged (merge = approval, adr/0003).
export type IterationStatus = "open" | "closed";
export function iterationStatus(root: string, id: string): IterationStatus {
  return mergeTrace(root, `iterations/${id}`) ? "closed" : "open";
}

// `origin` remote as a browsable https URL, e.g. for cockpit deep-links.
export function repositoryUrl(root: string): string | null {
  const res = spawnSync("git", ["-C", root, "remote", "get-url", "origin"], {
    encoding: "utf8",
  });
  if (res.status !== 0) return null;
  let url = res.stdout.trim();
  if (url.startsWith("git@github.com:")) {
    url = `https://github.com/${url.slice("git@github.com:".length)}`;
  }
  if (url.endsWith(".git")) url = url.slice(0, -".git".length);
  return url.startsWith("https://") ? url : null;
}

export interface Frontmatter {
  [key: string]: string | string[] | null;
}

export interface ParsedFile {
  fm: Frontmatter;
  body: string;
}

// Rubric v2 (adr/0006): criteria carry deterministic evidence — gates
// (binary, hard) and signals (numeric, thresholded) — and an optional LLM
// residue scored against anchors. Authored as a typed TS module
// (rubrics/rubric.ts), validated by tsc and by validateRubric() at load.
export interface RubricSignal {
  check: string; // checks/<check>.ts, must support --json
  metric: string; // key in the check's signals map
  min?: number; // thresholds: gated like a gate
  max?: number;
  ratchet?: boolean; // may not regress against the last recorded value
}

export interface RubricCriterion {
  id: string;
  description: string;
  weight: number;
  gates: string[]; // checks/<id>.ts — exit code is the verdict
  signals: RubricSignal[];
  judge: "llm" | "none";
  anchors?: { 0: string; 0.5: string; 1: string }; // required when judge is "llm"
}

export interface Rubric {
  version: 2;
  tolerance: number; // max drop of an llm score vs its last recorded value
  criteria: RubricCriterion[];
  adrs: Record<string, string[]>; // ADR slug → criterion ids (mirrors manifest.json)
}

// Loaded, validated, and indexed for the checks.
export interface LoadedRubric extends Rubric {
  byId: Record<string, RubricCriterion>;
}

export const RUBRIC_PATH = "rubrics/rubric.ts";

// The rubric is code (adr/0006): it may import only its own type. Any other
// import — anything that could execute — fails the traceability gate.
export function rubricImportViolations(text: string): string[] {
  const out: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (!/^\s*(import|export\s+.*\s+from)\b/.test(line)) continue;
    if (/^\s*import\s+type\s+\{[^}]*\}\s+from\s+["']\.\.\/checks\/lib\.ts["'];?\s*$/.test(line)) continue;
    out.push(`${RUBRIC_PATH}:${i + 1}: only 'import type { … } from "../checks/lib.ts"' is allowed`);
  }
  return out;
}

export async function loadRubric(root: string): Promise<LoadedRubric> {
  const file = join(root, RUBRIC_PATH);
  if (!existsSync(file)) throw new CheckError(`${RUBRIC_PATH}: missing`);
  const violations = rubricImportViolations(readFileSync(file, "utf8"));
  if (violations.length > 0) throw new CheckError(violations.join("\n"));
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown; rubric?: unknown };
  const rubric = validateRubric(mod.default ?? mod.rubric);
  const byId: Record<string, RubricCriterion> = {};
  for (const c of rubric.criteria) byId[c.id] = c;
  return { ...rubric, byId };
}

// Runtime shape check — tsc validates Teddy's own rubric, but a host's
// rubric (or a fixture's) reaches the checks untyped.
export function validateRubric(v: unknown): Rubric {
  const bad = (msg: string): never => {
    throw new CheckError(`${RUBRIC_PATH}: ${msg}`);
  };
  if (!v || typeof v !== "object") bad("default export must be a Rubric object");
  const r = v as Record<string, unknown>;
  if (r.version !== 2) bad(`version must be 2 (got ${String(r.version)})`);
  const tolerance = r.tolerance ?? 0.1;
  if (typeof tolerance !== "number" || tolerance < 0 || tolerance > 1) bad("tolerance must be a number in [0, 1]");
  if (!Array.isArray(r.criteria) || r.criteria.length === 0) bad("criteria must be a non-empty array");
  const seen = new Set<string>();
  for (const c of r.criteria as Record<string, unknown>[]) {
    const id = c.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) bad(`criterion id '${String(id)}' must be kebab-case`);
    if (seen.has(id as string)) bad(`duplicate criterion '${id}'`);
    seen.add(id as string);
    if (typeof c.description !== "string" || c.description.length === 0) bad(`'${id}': missing description`);
    if (typeof c.weight !== "number" || !(c.weight > 0)) bad(`'${id}': weight must be > 0`);
    if (!Array.isArray(c.gates) || c.gates.some((g) => typeof g !== "string")) bad(`'${id}': gates must be string[]`);
    if (!Array.isArray(c.signals)) bad(`'${id}': signals must be an array`);
    for (const sig of c.signals as Record<string, unknown>[]) {
      if (typeof sig.check !== "string" || typeof sig.metric !== "string") bad(`'${id}': signal needs check + metric`);
      if (sig.min !== undefined && typeof sig.min !== "number") bad(`'${id}': signal ${sig.check}.${sig.metric} min must be a number`);
      if (sig.max !== undefined && typeof sig.max !== "number") bad(`'${id}': signal ${sig.check}.${sig.metric} max must be a number`);
    }
    if (c.judge !== "llm" && c.judge !== "none") bad(`'${id}': judge must be "llm" | "none"`);
    if (c.judge === "llm") {
      const a = c.anchors as Record<string, unknown> | undefined;
      if (!a || [0, 0.5, 1].some((k) => typeof a[String(k)] !== "string" || (a[String(k)] as string).length === 0)) {
        bad(`'${id}': judge "llm" requires anchors for 0, 0.5 and 1`);
      }
    }
  }
  if (!r.adrs || typeof r.adrs !== "object") bad("adrs must be an object");
  for (const [slug, ids] of Object.entries(r.adrs as Record<string, unknown>)) {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" || !seen.has(x))) {
      bad(`adrs['${slug}'] must list known criterion ids`);
    }
  }
  return { ...(r as unknown as Rubric), tolerance };
}

// Check contract (adr/0006): `node checks/<id>.ts --json [root]` prints one
// JSON line as its last stdout line and exits non-zero only on fail. A check
// without --json support is a gate by exit code alone.
export type Verdict = "pass" | "skip" | "fail";
export interface CheckResult {
  id: string;
  verdict: Verdict;
  signals: Record<string, number>;
}

export function runCheck(root: string, id: string): CheckResult {
  const script = join(root, "checks", `${id}.ts`);
  if (!existsSync(script)) return { id, verdict: "fail", signals: {} };
  const res = spawnSync(process.execPath, [script, "--json", root], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME ?? "push" },
  });
  if (res.stderr) process.stderr.write(res.stderr);
  const lines = (res.stdout ?? "").trim().split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (last.startsWith("{")) {
    try {
      const parsed = JSON.parse(last) as Partial<CheckResult>;
      if (parsed.verdict === "pass" || parsed.verdict === "skip" || parsed.verdict === "fail") {
        return { id, verdict: parsed.verdict, signals: parsed.signals ?? {} };
      }
    } catch {
      // fall through: exit code decides
    }
  }
  return { id, verdict: res.status === 0 ? "pass" : "fail", signals: {} };
}

// Adapter helpers (adr/0004 pattern): the declaration in package.json is
// the configuration; the binary is the lockfile-pinned local install.
export function declaredDeps(root: string): Record<string, string> {
  const file = join(root, "package.json");
  if (!existsSync(file)) return {};
  const pkg = JSON.parse(readFileSync(file, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

export function localBin(root: string, name: string): string | null {
  const bin = join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
  return existsSync(bin) ? bin : null;
}

// Run a tool for an adapter. In --json mode the tool's stdout is forwarded
// to stderr so the contract line stays the last line of stdout.
export function runTool(
  root: string,
  cmd: string,
  args: string[],
  json: boolean,
): { status: number | null; signal: NodeJS.Signals | null } {
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: json ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (json && res.stdout) process.stderr.write(res.stdout);
  return { status: res.status, signal: res.signal };
}

// Finish an adapter: print the contract line when --json was asked for,
// and exit with the contract's code.
export function emitResult(
  id: string,
  verdict: Verdict,
  json: boolean,
  signals: Record<string, number> = {},
): never {
  if (json) console.log(JSON.stringify({ id, verdict, signals }));
  process.exit(verdict === "fail" ? 1 : 0);
}

export function readText(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

export function exists(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

export function readJson<T>(root: string, rel: string): T {
  return JSON.parse(readText(root, rel)) as T;
}

export function writeText(root: string, rel: string, content: string): void {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export function parseValue(raw: string): string | string[] | null {
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => unquote(s.trim()));
  }
  return unquote(value);
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseFrontmatter(text: string, file: string): ParsedFile {
  if (!text.startsWith("---\n")) {
    throw new CheckError(`${file}: missing YAML frontmatter (must start with '---')`);
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    throw new CheckError(`${file}: unterminated frontmatter (no closing '---')`);
  }
  const block = text.slice(4, end);
  const fm: Frontmatter = {};
  for (const line of block.split("\n")) {
    if (line.trim() === "") continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$/);
    if (!m) throw new CheckError(`${file}: bad frontmatter line: ${JSON.stringify(line)}`);
    fm[m[1]] = parseValue(m[2]);
  }
  return { fm, body: text.slice(end + 4) };
}

export const ADR_STATUSES = ["proposed", "accepted", "deprecated", "superseded"] as const;

export interface AdrInfo {
  file: string; // e.g. "adr/0001-teddy-bootstrap.md"
  slug: string; // e.g. "0001-teddy-bootstrap"
  fm: Frontmatter;
}

export function listAdrs(root: string): AdrInfo[] {
  const dir = join(root, "adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const rel = `adr/${f}`;
      const { fm } = parseFrontmatter(readText(root, rel), rel);
      return { file: rel, slug: f.replace(/\.md$/, ""), fm };
    });
}

export function listCheckScripts(root: string): string[] {
  const dir = join(root, "checks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .sort();
}

// Σ(weight_i × score_i) / Σ(weight_i) over non-null criteria; null when
// no criterion was exercised (callers decide whether that is an error).
export function weightedOverall(
  criteria: Record<string, { score: number | null }>,
  rubric: LoadedRubric,
): number | null {
  let num = 0;
  let den = 0;
  for (const [id, entry] of Object.entries(criteria)) {
    if (entry.score === null || entry.score === undefined) continue;
    const c = rubric.byId[id];
    if (!c) throw new CheckError(`unknown criterion '${id}'`);
    num += c.weight * entry.score;
    den += c.weight;
  }
  return den === 0 ? null : num / den;
}

export class CheckError extends Error {}
