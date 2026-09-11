// Deterministic traceability gate (serves rubric criterion 'adr-traceability').
// Verifies: ADR frontmatter integrity, the merge-as-approval lifecycle gate
// (adr/0003), manifest.json ↔ adr ↔ rubric.yaml consistency, and orphan
// detection.
// Usage: node checks/manifest-sync.ts [root] [--fix]
// Exit 0 = consistent, 1 = failures listed below. --fix syncs manifest
// statuses from ADR frontmatter, then re-verifies and reports what remains.
import {
  ADR_STATUSES,
  exists,
  isGitRepo,
  listAdrs,
  listCheckScripts,
  mergeTrace,
  parseRubric,
  readJson,
  readText,
  writeText,
  type AdrInfo,
} from "./lib.ts";

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();

let rubric: ReturnType<typeof parseRubric>;
try {
  rubric = parseRubric(readText(root, "rubrics/rubric.yaml"));
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
}

const manifestPath = "manifest.json";
const manifest = readJson<Record<string, unknown>>(root, manifestPath);
const adrs = manifest.adrs as
  | Record<string, { status: string; assertions: string[]; criteria: string[] }>
  | undefined;
if (!adrs || typeof adrs !== "object") {
  console.error("FAIL: manifest.json: missing 'adrs' map");
  process.exit(1);
}

const parsed: AdrInfo[] = listAdrs(root);

// Accepted via direct commits before adr/0003 existed (bootstrap). Extend
// only through this gated flow — additions are reviewable PR changes.
const GRANDFATHERED_ACCEPTED = new Set(["0001-teddy-bootstrap", "0002-cockpit-minimal-scope"]);

// Every check script linked from manifest.json (lib.ts excepted — shared
// plumbing, not an assertion).
const referenced = new Set<string>();
for (const entry of Object.values(adrs)) {
  for (const a of strArray(entry.assertions)) referenced.add(a);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function verify(): string[] {
  const fails: string[] = [];
  const fail = (msg: string): void => {
    fails.push(msg);
  };
  const unclaimed = new Set(Object.keys(adrs));

  for (const adr of parsed) {
    const { file, slug, fm } = adr;
    const id = fm.id;
    const status = fm.status;
    if (typeof id !== "string" || !slug.startsWith(`${id}-`)) {
      fail(`${file}: frontmatter id '${id}' does not match filename slug '${slug}'`);
    }
    if ("approved_by" in fm) {
      fail(`${file}: legacy field 'approved_by' — removed by adr/0003 (approval is the merge)`);
    }
    if (typeof status !== "string" || !ADR_STATUSES.includes(status as never)) {
      fail(`${file}: invalid status '${status}' (${ADR_STATUSES.join(" | ")})`);
      continue;
    }
    // The lifecycle gate (adr/0003): any transition out of 'proposed' must
    // have landed via a true merge commit — merge = approval.
    if (status !== "proposed") {
      if (GRANDFATHERED_ACCEPTED.has(slug)) {
        // accepted pre-regime via direct bootstrap commits
      } else if (!isGitRepo(root)) {
        fail(`${file}: cannot verify merge trace — not a git repository (adr/0003)`);
      } else {
        const trace = mergeTrace(root, file);
        if (!trace) {
          fail(
            `${file}: status '${status}' requires a merge commit touching it ` +
              `(merge = approval, adr/0003); squash/rebase merges defeat traceability`,
          );
        }
      }
    }
    for (const ref of strArray(fm.rubric_refs)) {
      if (!rubric.criteria[ref]) fail(`${file}: rubric_refs references unknown criterion '${ref}'`);
    }
    const supersedes = fm.supersedes;
    const supersededBy = fm.superseded_by;
    if (typeof supersedes === "string") {
      const target = parsed.find((a) => a.slug === supersedes);
      if (!target) fail(`${file}: supersedes '${supersedes}' does not exist`);
      else if (target.fm.superseded_by !== slug) {
        fail(`${file}: supersedes '${supersedes}' but backref superseded_by is '${target.fm.superseded_by}'`);
      }
    }
    if (typeof supersededBy === "string") {
      const target = parsed.find((a) => a.slug === supersededBy);
      if (!target) fail(`${file}: superseded_by '${supersededBy}' does not exist`);
      else if (target.fm.supersedes !== slug) {
        fail(`${file}: superseded_by '${supersededBy}' but that ADR does not list '${slug}' in supersedes`);
      }
    }

    const entry = adrs?.[slug];
    if (!entry) {
      fail(`manifest.json: missing entry for ADR '${slug}'`);
      continue;
    }
    unclaimed.delete(slug);
    if ("approved_by" in entry) {
      fail(`manifest.json: legacy field 'approved_by' on '${slug}' — removed by adr/0003`);
    }
    if (entry.status !== status) {
      fail(
        `manifest.json: status drift for '${slug}': manifest=${entry.status} ` +
          `frontmatter=${status} — run: node checks/manifest-sync.ts . --fix`,
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
    // rubric.yaml ↔ manifest.json criteria parity (manifest is the SSOT for
    // links, but the rubric's adrs section must not contradict it).
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

  for (const slug of unclaimed) {
    fail(`manifest.json: entry '${slug}' has no ADR file under adr/`);
  }

  // Orphan detection: every check script must be linked from ≥1 ADR.
  for (const f of listCheckScripts(root)) {
    const rel = `checks/${f}`;
    if (f !== "lib.ts" && !referenced.has(rel)) {
      fail(`orphaned assertion (not linked in manifest.json): ${rel}`);
    }
  }

  return fails;
}

function applyStatusFix(): void {
  // Mutate the in-memory manifest that verify() reads, then write that same
  // object — otherwise re-verification runs against stale values.
  for (const adr of parsed) {
    const entry = adrs?.[adr.slug];
    if (entry) {
      entry.status = adr.fm.status as string;
    }
  }
  writeText(root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

let fails = verify();
if (fix && fails.length > 0) {
  applyStatusFix();
  fails = verify();
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
