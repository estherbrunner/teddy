// Shared parsing + aggregation helpers for Teddy's deterministic checks.
// Runs under Node's native type-stripping: erasable syntax only, ESM,
// relative imports must carry the .ts extension.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface Frontmatter {
  [key: string]: string | string[] | null;
}

export interface ParsedFile {
  fm: Frontmatter;
  body: string;
}

export interface RubricCriterion {
  id: string;
  description: string;
  weight: number;
  judge: string;
}

export interface Rubric {
  version: number;
  criteria: Record<string, RubricCriterion>;
  adrs: Record<string, string[]>;
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

// Minimal parser for the fixed rubric.yaml schema (see adr/0001):
//   version: N
//   criteria:            - id / description / weight / judge items
//   adrs:                slug → criteria list
// Hand-rolled on purpose: zero dependencies, and the schema is
// ADR-governed so the parser may fail loudly on anything unexpected.
export function parseRubric(text: string): Rubric {
  const lines = text.split("\n");
  const rubric: Rubric = { version: 0, criteria: {}, adrs: {} };
  let section = "";
  let item: RubricCriterion | null = null;
  let adrSlug = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripComment(raw);
    if (line.trim() === "") continue;
    if (!raw.startsWith(" ") && raw.trim() !== "") {
      const m = line.match(/^([A-Za-z_]+):\s?(.*)$/);
      if (!m) throw new CheckError(`rubrics/rubric.yaml:${i + 1}: bad line: ${JSON.stringify(raw)}`);
      if (m[1] === "version") {
        rubric.version = Number(m[2]);
      } else if (m[1] === "criteria" || m[1] === "adrs") {
        section = m[1];
      } else {
        throw new CheckError(`rubrics/rubric.yaml:${i + 1}: unknown top-level key '${m[1]}'`);
      }
      continue;
    }
    if (section === "criteria") {
      const start = line.match(/^\s*-\s*id:\s*(\S+)\s*$/);
      if (start) {
        item = { id: start[1], description: "", weight: 0, judge: "" };
        rubric.criteria[item.id] = item;
        continue;
      }
      const field = line.match(/^\s+(\w+):\s?(.*)$/);
      if (field && item) {
        if (field[1] === "description") item.description = field[2].trim();
        else if (field[1] === "weight") item.weight = Number(field[2]);
        else if (field[1] === "judge") item.judge = field[2].trim();
        else throw new CheckError(`rubrics/rubric.yaml:${i + 1}: unknown criterion field '${field[1]}'`);
        continue;
      }
      throw new CheckError(`rubrics/rubric.yaml:${i + 1}: unexpected line in criteria: ${JSON.stringify(raw)}`);
    }
    if (section === "adrs") {
      const slug = line.match(/^ {2}(\S+):\s*$/);
      if (slug) {
        adrSlug = slug[1];
        rubric.adrs[adrSlug] = [];
        continue;
      }
      const crit = line.match(/^ {4}criteria:\s*\[(.*)\]\s*$/);
      if (crit && adrSlug) {
        rubric.adrs[adrSlug] = crit[1] === "" ? [] : crit[1].split(",").map((s) => s.trim());
        continue;
      }
      throw new CheckError(`rubrics/rubric.yaml:${i + 1}: unexpected line in adrs: ${JSON.stringify(raw)}`);
    }
  }
  if (rubric.version < 1) throw new CheckError("rubrics/rubric.yaml: missing version");
  return rubric;
}

function stripComment(line: string): string {
  // strip ' #...' inline comments (but not '#' glued to a word, e.g. in URLs)
  const idx = line.search(/\s#/);
  return idx === -1 ? line : line.slice(0, idx);
}

// Σ(weight_i × score_i) / Σ(weight_i) over non-null criteria; null when
// no criterion was exercised (callers decide whether that is an error).
export function weightedOverall(
  criteria: Record<string, { score: number | null }>,
  rubric: Rubric,
): number | null {
  let num = 0;
  let den = 0;
  for (const [id, entry] of Object.entries(criteria)) {
    if (entry.score === null || entry.score === undefined) continue;
    const c = rubric.criteria[id];
    if (!c) throw new CheckError(`unknown criterion '${id}'`);
    num += c.weight * entry.score;
    den += c.weight;
  }
  return den === 0 ? null : num / den;
}

export class CheckError extends Error {}
