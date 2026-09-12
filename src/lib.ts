// Teddy's library: configuration, rubric types, derived iteration model,
// git helpers, and the check runner. Runs from source under Node's native
// type stripping (erasable syntax only, ESM, .ts import specifiers) and
// from dist/ after tsc (adr/0007). Hosts import only types from here.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration (adr/0007): zero-config defaults, overridable by an optional
// teddy.config.ts that may import nothing but the Config type.

export interface Config {
  dirs?: { adr?: string; iterations?: string; checks?: string };
  pattern?: RegExp; // directory naming for ADRs and iterations
  main?: string; // trunk branch
  src?: string[]; // code under judgment (judge diff, coverage paths)
  rubric?: Rubric;
}

export interface ResolvedConfig {
  dirs: { adr: string; iterations: string; checks: string };
  pattern: RegExp;
  main: string;
  src: string[];
  rubric: LoadedRubric;
}

export const CONFIG_PATH = "teddy.config.ts";

// Where the built-in checks live: src/checks/*.ts from source, dist/checks/*.js
// after build — resolved from this module's own location.
const here = dirname(fileURLToPath(import.meta.url));
export const BUILTIN_EXT = import.meta.url.endsWith(".js") ? ".js" : ".ts";
export const BUILTIN_CHECKS_DIR = join(here, "checks");
export const PACKAGE_ROOT = resolve(here, "..");

export function listBuiltinChecks(): string[] {
  return readdirSync(BUILTIN_CHECKS_DIR)
    .filter((f) => f.endsWith(BUILTIN_EXT))
    .map((f) => f.slice(0, -BUILTIN_EXT.length))
    .sort();
}

// Minimal traceability rubric for hosts that configure nothing. The
// host-project criteria (correctness, security, …) follow their adapters.
export const DEFAULT_RUBRIC: Rubric = {
  version: 2,
  tolerance: 0.1,
  criteria: [
    {
      id: "traceability",
      description: "Every accepted ADR has ≥1 linked assertion or rubric criterion; no orphaned checks",
      weight: 1,
      gates: ["manifest-sync"],
      signals: [],
      judge: "none",
    },
    {
      id: "hygiene",
      description: "The tree type-checks and lints clean with the tools the project declares",
      weight: 1,
      gates: ["typecheck", "lint"],
      signals: [],
      judge: "none",
    },
    {
      id: "correctness",
      description: "The declared test suite passes",
      weight: 2,
      gates: ["test"],
      signals: [],
      judge: "none",
    },
  ],
};

export async function loadConfig(root: string): Promise<ResolvedConfig> {
  const file = join(root, CONFIG_PATH);
  let cfg: Config = {};
  if (existsSync(file)) {
    const violations = configImportViolations(readFileSync(file, "utf8"), CONFIG_PATH);
    if (violations.length > 0) throw new CheckError(violations.join("\n"));
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    cfg = validateConfig(mod.default);
  }
  const rubric = validateRubric(cfg.rubric ?? DEFAULT_RUBRIC);
  const byId: Record<string, RubricCriterion> = {};
  for (const c of rubric.criteria) byId[c.id] = c;
  return {
    dirs: { adr: cfg.dirs?.adr ?? "adr", iterations: cfg.dirs?.iterations ?? "iterations", checks: cfg.dirs?.checks ?? "checks" },
    pattern: cfg.pattern ?? /^\d{4}-[a-z0-9-]+$/,
    main: cfg.main ?? "main",
    src: cfg.src ?? ["src/**"],
    rubric: { ...rubric, tolerance: rubric.tolerance ?? 0.1, byId },
  };
}

// Configuration is data: only type-only imports (erased at runtime) are
// allowed, whatever they point at.
export function configImportViolations(text: string, file: string): string[] {
  const out: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (!/^\s*(import|export\s+.*\s+from)\b/.test(line)) continue;
    if (/^\s*import\s+type\s+\{[^}]*\}\s+from\s+["'][^"']+["'];?\s*$/.test(line)) continue;
    out.push(`${file}:${i + 1}: only 'import type { … } from "…"' is allowed — configuration is data`);
  }
  return out;
}

export function validateConfig(v: unknown): Config {
  const bad = (msg: string): never => {
    throw new CheckError(`${CONFIG_PATH}: ${msg}`);
  };
  if (!v || typeof v !== "object") bad("default export must be a Config object");
  const c = v as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    if (!["dirs", "pattern", "main", "src", "rubric"].includes(k)) bad(`unknown key '${k}'`);
  }
  if (c.dirs !== undefined) {
    if (typeof c.dirs !== "object" || c.dirs === null) bad("dirs must be an object");
    for (const [k, d] of Object.entries(c.dirs as Record<string, unknown>)) {
      if (!["adr", "iterations", "checks"].includes(k)) bad(`dirs: unknown key '${k}'`);
      if (typeof d !== "string" || d === "" || d.startsWith("/") || d.includes("..")) bad(`dirs.${k} must be a relative directory`);
    }
  }
  if (c.pattern !== undefined && !(c.pattern instanceof RegExp)) bad("pattern must be a RegExp");
  if (c.main !== undefined && (typeof c.main !== "string" || c.main === "")) bad("main must be a branch name");
  if (c.src !== undefined && (!Array.isArray(c.src) || c.src.some((g) => typeof g !== "string"))) bad("src must be string[]");
  return c as Config;
}

// ---------------------------------------------------------------------------
// Git

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

// The trunk, wherever this checkout has it (CI checkouts of a PR carry
// origin/main but no local main).
export function trunkRef(root: string, main: string): string | null {
  for (const ref of [main, `origin/${main}`]) {
    if (spawnSync("git", ["-C", root, "rev-parse", "--verify", "-q", ref], { encoding: "utf8" }).status === 0) return ref;
  }
  return null;
}

// Does `rel` exist in the tree at `ref`?
export function existsAt(root: string, ref: string, rel: string): boolean {
  return spawnSync("git", ["-C", root, "cat-file", "-e", `${ref}:${rel}`], { encoding: "utf8" }).status === 0;
}

// ---------------------------------------------------------------------------
// Iterations (adr/0007): derived, never stored. An iteration is a directory
// under dirs.iterations matching the pattern; it is closed iff a first-parent
// merge commit touches it (adr/0005); its baseline is the previous iteration
// in trunk merge order — closed ones by (merge order, number), then open ones
// by number. On a PR branch the closed set is the trunk history up to the
// merge base, so concurrent PRs each see the right baseline.

export interface Iteration {
  id: string;
  dir: string; // relative, e.g. iterations/0001-slug
  ticket: string; // relative path to ticket.md
  scores: string; // relative path to scores.json
  status: IterationStatus;
  pr: number | null;
  baseline: string | null;
  onTrunk: boolean; // directory exists at the merge base with the trunk
}

export function listIterations(root: string, cfg: ResolvedConfig): Iteration[] {
  const dir = join(root, cfg.dirs.iterations);
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((d) => !d.startsWith(".") && statSync(join(dir, d)).isDirectory())
    .sort();
  // First-parent merge order on this ref: index 0 = newest.
  const merges = spawnSync("git", ["-C", root, "log", "--first-parent", "--merges", "--format=%h"], { encoding: "utf8" })
    .stdout.trim().split("\n").filter(Boolean);
  const order = new Map(merges.map((h, i) => [h, merges.length - i])); // older = smaller
  const trunk = trunkRef(root, cfg.main);
  const base = trunk
    ? spawnSync("git", ["-C", root, "merge-base", trunk, "HEAD"], { encoding: "utf8" }).stdout.trim()
    : "";
  const items = names.map((id) => {
    const rel = `${cfg.dirs.iterations}/${id}`;
    const trace = mergeTrace(root, rel, true);
    const hash = trace?.split(" ")[0] ?? "";
    return {
      id,
      rel,
      mergeIndex: trace ? (order.get(hash) ?? 0) : Number.POSITIVE_INFINITY,
      pr: trace ? mergedPr(root, rel) : null,
      onTrunk: base !== "" && existsAt(root, base, rel),
    };
  });
  items.sort((a, b) => (a.mergeIndex - b.mergeIndex) || a.id.localeCompare(b.id));
  let prev: string | null = null;
  return items.map((it) => {
    const out: Iteration = {
      id: it.id,
      dir: it.rel,
      ticket: `${it.rel}/ticket.md`,
      scores: `${it.rel}/scores.json`,
      status: Number.isFinite(it.mergeIndex) ? "closed" : "open",
      pr: it.pr,
      baseline: prev,
      onTrunk: it.onTrunk,
    };
    prev = it.id;
    return out;
  });
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
  tolerance?: number; // max drop of an llm score vs its last recorded value (default 0.1)
  criteria: RubricCriterion[];
}

// Loaded, validated, and indexed for the checks.
export interface LoadedRubric extends Rubric {
  tolerance: number;
  byId: Record<string, RubricCriterion>;
}

// Runtime shape check — tsc validates a typed config, but a host's rubric
// (or a fixture's) reaches the checks untyped.
export function validateRubric(v: unknown): Rubric {
  const bad = (msg: string): never => {
    throw new CheckError(`${CONFIG_PATH}: rubric: ${msg}`);
  };
  if (!v || typeof v !== "object") bad("default export must be a Rubric object");
  const r = v as Record<string, unknown>;
  if (r.version !== 2) bad(`version must be 2 (got ${String(r.version)})`);
  const tolerance = r.tolerance === undefined ? 0.1 : r.tolerance;
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
  if ("adrs" in r) bad("legacy 'adrs' map — ADR ↔ criterion links live in ADR frontmatter rubric_refs (adr/0007)");
  return { ...(r as unknown as Rubric), tolerance: tolerance as number };
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

// A check id resolves to the host's checks/<id>.ts first, then to a
// built-in (adr/0007). Null when neither exists.
export function resolveCheck(root: string, cfg: ResolvedConfig, id: string): string | null {
  const host = join(root, cfg.dirs.checks, `${id}.ts`);
  if (existsSync(host)) return host;
  const builtin = join(BUILTIN_CHECKS_DIR, `${id}${BUILTIN_EXT}`);
  return existsSync(builtin) ? builtin : null;
}

// `teddy:<id>` assertions may name a built-in check or command.
export function resolveBuiltin(id: string): string | null {
  for (const dir of [BUILTIN_CHECKS_DIR, join(here, "commands")]) {
    const f = join(dir, `${id}${BUILTIN_EXT}`);
    if (existsSync(f)) return f;
  }
  return null;
}

export function runCheck(root: string, cfg: ResolvedConfig, id: string): CheckResult {
  const script = resolveCheck(root, cfg, id);
  if (!script) return { id, verdict: "fail", signals: {} };
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

// ADR frontmatter is the single source for status, rubric_refs, and
// assertions (adr/0007): `checks/x.ts` (host) or `teddy:<id>` (built-in).
export interface AdrInfo {
  file: string; // e.g. "adr/0001-teddy-bootstrap.md"
  slug: string; // e.g. "0001-teddy-bootstrap"
  fm: Frontmatter;
  status: string;
  rubricRefs: string[];
  assertions: string[];
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

export function listAdrs(root: string, cfg: ResolvedConfig): AdrInfo[] {
  const dir = join(root, cfg.dirs.adr);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const rel = `${cfg.dirs.adr}/${f}`;
      const { fm } = parseFrontmatter(readText(root, rel), rel);
      return {
        file: rel,
        slug: f.replace(/\.md$/, ""),
        fm,
        status: String(fm.status),
        rubricRefs: strList(fm.rubric_refs),
        assertions: strList(fm.assertions),
      };
    });
}

// Host check scripts (every one must be linked from ≥1 ADR — orphan rule).
export function listHostChecks(root: string, cfg: ResolvedConfig): string[] {
  const dir = join(root, cfg.dirs.checks);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && f !== "lib.ts")
    .sort()
    .map((f) => `${cfg.dirs.checks}/${f}`);
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
