// Deterministic traceability gate (serves rubric criterion 'adr-traceability').
// Verifies: ADR frontmatter integrity, the human-approval lifecycle gate,
// manifest.json ↔ adr ↔ rubric.yaml consistency, and orphan detection.
// Usage: node checks/manifest-sync.ts [root] [--fix]
// Exit 0 = consistent, 1 = failures listed below.
import {
  ADR_STATUSES,
  exists,
  listAdrs,
  listCheckScripts,
  parseRubric,
  readJson,
  readText,
  writeText,
  type Frontmatter,
} from "./lib.ts";

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();

const fails: string[] = [];
function fail(msg: string): void {
  fails.push(msg);
}

function approvedBy(fm: Frontmatter): string | null {
  const v = fm["approved_by"];
  return typeof v === "string" && v !== "" ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

let rubric: ReturnType<typeof parseRubric>;
try {
  rubric = parseRubric(readText(root, "rubrics/rubric.yaml"));
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
}

const manifestPath = "manifest.json";
const manifest = readJson<Record<string, unknown>>(root, manifestPath);
const adrs = manifest["adrs"] as Record<
  string,
  { status: string; approved_by: string | null; assertions: string[]; criteria: string[] }
> | undefined;
if (!adrs || typeof adrs !== "object") {
  console.error("FAIL: manifest.json: missing 'adrs' map");
  process.exit(1);
}

const parsed = listAdrs(root);
const manifestSlugs = new Set(Object.keys(adrs));

for (const adr of parsed) {
  const { file, slug, fm } = adr;
  const id = fm["id"];
  const status = fm["status"];
  if (typeof id !== "string" || !slug.startsWith(`${id}-`)) {
    fail(`${file}: frontmatter id '${id}' does not match filename slug '${slug}'`);
  }
  if (typeof status !== "string" || !ADR_STATUSES.includes(status as never)) {
    fail(`${file}: invalid status '${status}' (${ADR_STATUSES.join(" | ")})`);
    continue;
  }
  // The human gate: any transition out of 'proposed' requires an approver.
  if (status !== "proposed" && approvedBy(fm) === null) {
    fail(`${file}: status '${status}' requires non-null approved_by (human gate)`);
  }
  for (const ref of strArray(fm["rubric_refs"])) {
    if (!rubric.criteria[ref]) fail(`${file}: rubric_refs references unknown criterion '${ref}'`);
  }
  const supersedes = fm["supersedes"];
  const supersededBy = fm["superseded_by"];
  if (typeof supersedes === "string") {
    const target = parsed.find((a) => a.slug === supersedes);
    if (!target) fail(`${file}: supersedes '${supersedes}' does not exist`);
    else if (target.fm["superseded_by"] !== slug) {
      fail(`${file}: supersedes '${supersedes}' but backref superseded_by is '${target.fm["superseded_by"]}'`);
    }
  }
  if (typeof supersededBy === "string") {
    const target = parsed.find((a) => a.slug === supersededBy);
    if (!target) fail(`${file}: superseded_by '${supersededBy}' does not exist`);
    else if (target.fm["supersedes"] !== slug) {
      fail(`${file}: superseded_by '${supersededBy}' but that ADR does not list '${slug}' in supersedes`);
    }
  }

  const entry = adrs[slug];
  if (!entry) {
    fail(`manifest.json: missing entry for ADR '${slug}'`);
    continue;
  }
  manifestSlugs.delete(slug);
  if (entry.status !== status || entry.approved_by !== approvedBy(fm)) {
    fail(
      `manifest.json: status drift for '${slug}': manifest=${entry.status}/${entry.approved_by} ` +
        `frontmatter=${status}/${approvedBy(fm)} — run: node checks/manifest-sync.ts . --fix`,
    );
  }
  const assertions = strArray(entry.assertions);
  for (const a of assertions) {
    if (!exists(root, a)) fail(`manifest.json: assertion '${a}' of '${slug}' does not exist`);
  }
  for (const c of strArray(entry.criteria)) {
    if (!rubric.criteria[c]) {
      fail(`manifest.json: criteria drift for '${slug}': unknown criterion '${c}'`);
    }
  }
  if (status === "accepted" && assertions.length === 0 && strArray(entry.criteria).length === 0) {
    fail(`manifest.json: traceability: accepted ADR '${slug}' has neither assertion nor criterion`);
  }
  // rubric.yaml ↔ manifest.json criteria parity (single source of truth: manifest,
  // but the rubric's adrs section must not contradict it).
  const rubricCriteria = rubric.adrs[slug];
  if (rubricCriteria) {
    if (JSON.stringify([...strArray(entry.criteria)].sort()) !== JSON.stringify([...rubricCriteria].sort())) {
      fail(
        `manifest.json: criteria drift for '${slug}': manifest=[${strArray(entry.criteria)}] ` +
          `rubric.yaml=[${rubricCriteria}]`,
      );
    }
  } else if (strArray(entry.criteria).length > 0) {
    fail(`manifest.json: criteria drift for '${slug}': linked criteria but rubric.yaml has no entry`);
  }
}

for (const slug of manifestSlugs) {
  fail(`manifest.json: entry '${slug}' has no ADR file under adr/`);
}

// Orphan detection: every check script must be linked from ≥1 ADR
// (lib.ts excepted — it is shared plumbing, not an assertion).
const referenced = new Set<string>();
for (const entry of Object.values(adrs)) {
  for (const a of strArray(entry.assertions)) referenced.add(a);
}
for (const f of listCheckScripts(root)) {
  const rel = `checks/${f}`;
  if (f !== "lib.ts" && !referenced.has(rel)) {
    fail(`orphaned assertion (not linked in manifest.json): ${rel}`);
  }
}

if (fix) {
  const raw = JSON.parse(readText(root, manifestPath)) as typeof manifest;
  for (const adr of parsed) {
    const entry = raw["adrs"]![adr.slug];
    if (entry) {
      entry.status = adr.fm["status"] as string;
      entry.approved_by = approvedBy(adr.fm);
    }
  }
  writeText(root, manifestPath, JSON.stringify(raw, null, 2) + "\n");
  console.log(`manifest-sync: synced statuses from ADR frontmatter into ${manifestPath}`);
}

if (fails.length > 0) {
  for (const f of fails) console.error(`FAIL: ${f}`);
  console.error(`\nmanifest-sync: ${fails.length} failure(s)`);
  process.exit(1);
}
console.log(
  `manifest-sync: OK (${parsed.length} ADRs, ${referenced.size} linked assertions, ` +
    `${Object.keys(rubric.criteria).length} criteria)`,
);
