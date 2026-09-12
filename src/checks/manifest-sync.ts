// Deterministic traceability gate (serves the traceability criterion).
// Since adr/0007 the ADR frontmatter is the single source: status,
// rubric_refs, assertions. Verifies frontmatter integrity, the merge-as-
// approval lifecycle gate (adr/0003), that every accepted ADR resolves to
// ≥1 assertion or criterion, that assertions and rubric gates/signals
// resolve to check scripts, orphan detection for host checks, and that the
// configuration imports nothing but types (adr/0006).
// Usage: node manifest-sync.ts [--json] [root]
// Exit 0 = consistent, 1 = failures listed below.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADR_STATUSES,
  CONFIG_PATH,
  configImportViolations,
  emitResult,
  exists,
  isGitRepo,
  listAdrs,
  listHostChecks,
  loadConfig,
  mergeTrace,
  resolveBuiltin,
  resolveCheck,
  type ResolvedConfig,
} from "../lib.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const pendingMergeContext = process.env.GITHUB_EVENT_NAME === "pull_request";
const log = (msg: string): void => (json ? console.error(msg) : console.log(msg));

let cfg: ResolvedConfig;
try {
  cfg = await loadConfig(root);
} catch (e) {
  console.error(`FAIL: ${(e as Error).message}`);
  emitResult("manifest-sync", "fail", json);
}

// Accepted via direct commits before adr/0003 existed (bootstrap). Extend
// only through this gated flow — additions are reviewable PR changes.
const GRANDFATHERED_ACCEPTED = new Set(["0001-teddy-bootstrap", "0002-cockpit-minimal-scope"]);

const fails: string[] = [];
const fail = (msg: string): void => {
  fails.push(msg);
};

const configFile = join(root, CONFIG_PATH);
if (existsSync(configFile)) {
  for (const v of configImportViolations(readFileSync(configFile, "utf8"), CONFIG_PATH)) fail(v);
}

const adrs = listAdrs(root, cfg);
const linkedHostChecks = new Set<string>();

for (const adr of adrs) {
  const { file, slug, fm, status } = adr;
  const id = fm.id;
  if (typeof id !== "string" || !slug.startsWith(`${id}-`)) {
    fail(`${file}: frontmatter id '${id}' does not match filename slug '${slug}'`);
  }
  if (!cfg.pattern.test(slug)) fail(`${file}: name does not match pattern ${cfg.pattern}`);
  if ("approved_by" in fm) {
    fail(`${file}: legacy field 'approved_by' — removed by adr/0003 (approval is the merge)`);
  }
  if (!ADR_STATUSES.includes(status as never)) {
    fail(`${file}: invalid status '${status}' (${ADR_STATUSES.join(" | ")})`);
    continue;
  }
  // The lifecycle gate (adr/0003): any transition out of 'proposed' must
  // have landed via a true merge commit — merge = approval. On a pull
  // request the branch carries the target status and the merge realizes
  // it, so the trace is pending there and reconciled on main (adr/0005).
  if (status !== "proposed") {
    if (GRANDFATHERED_ACCEPTED.has(slug)) {
      // accepted pre-regime via direct bootstrap commits
    } else if (!isGitRepo(root)) {
      fail(`${file}: cannot verify merge trace — not a git repository (adr/0003)`);
    } else {
      const trace = mergeTrace(root, file);
      if (!trace && pendingMergeContext) {
        log(`manifest-sync: ${file} '${status}' pending merge — trace reconciled on main`);
      } else if (!trace) {
        fail(
          `${file}: status '${status}' requires a merge commit touching it ` +
            `(merge = approval, adr/0003); squash/rebase merges defeat traceability`,
        );
      }
    }
  }
  for (const ref of adr.rubricRefs) {
    if (!cfg.rubric.byId[ref]) fail(`${file}: rubric_refs references unknown criterion '${ref}'`);
  }
  if (!Array.isArray(fm.assertions)) fail(`${file}: missing 'assertions' list (checks/x.ts or teddy:<id>; [] if none)`);
  for (const a of adr.assertions) {
    if (a.startsWith("teddy:")) {
      if (!resolveBuiltin(a.slice("teddy:".length))) fail(`${file}: assertion '${a}' is not a built-in check or command`);
    } else if (!exists(root, a)) {
      fail(`${file}: assertion '${a}' does not exist`);
    } else {
      linkedHostChecks.add(a);
    }
  }
  if (status === "accepted" && adr.assertions.length === 0 && adr.rubricRefs.length === 0) {
    fail(`${file}: traceability: accepted ADR has neither assertion nor rubric criterion`);
  }
  const supersedes = fm.supersedes;
  const supersededBy = fm.superseded_by;
  if (typeof supersedes === "string") {
    const target = adrs.find((a) => a.slug === supersedes);
    if (!target) fail(`${file}: supersedes '${supersedes}' does not exist`);
    else if (target.fm.superseded_by !== slug) {
      fail(`${file}: supersedes '${supersedes}' but backref superseded_by is '${target.fm.superseded_by}'`);
    }
  }
  if (typeof supersededBy === "string") {
    const target = adrs.find((a) => a.slug === supersededBy);
    if (!target) fail(`${file}: superseded_by '${supersededBy}' does not exist`);
    else if (target.fm.supersedes !== slug) {
      fail(`${file}: superseded_by '${supersededBy}' but that ADR does not list '${slug}' in supersedes`);
    }
  }
}

// Orphan detection: every host check script must be linked from ≥1 ADR.
for (const rel of listHostChecks(root, cfg)) {
  if (!linkedHostChecks.has(rel)) fail(`orphaned assertion (not linked from any ADR): ${rel}`);
}

// Rubric gates and signals must resolve to check scripts (adr/0006).
for (const c of cfg.rubric.criteria) {
  for (const g of c.gates) {
    if (!resolveCheck(root, cfg, g)) fail(`${CONFIG_PATH}: rubric '${c.id}' gate '${g}' resolves to no check (host or built-in)`);
  }
  for (const sig of c.signals) {
    if (!resolveCheck(root, cfg, sig.check)) {
      fail(`${CONFIG_PATH}: rubric '${c.id}' signal '${sig.check}.${sig.metric}' resolves to no check`);
    }
  }
}

if (fails.length > 0) {
  for (const f of fails) console.error(`FAIL: ${f}`);
  console.error(`\nmanifest-sync: ${fails.length} failure(s)`);
  emitResult("manifest-sync", "fail", json);
}
log(
  `manifest-sync: OK (${adrs.length} ADRs, ${linkedHostChecks.size} host assertions, ${cfg.rubric.criteria.length} criteria)`,
);
emitResult("manifest-sync", "pass", json);
