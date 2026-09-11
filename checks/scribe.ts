// Scribe: the deterministic writer of derived state (adr/0003, as amended).
// Runs in CI on pushes to `iteration/*` pull-request branches: when the tree
// is ready to close — gates green after the flip — it flips the registry
// entry to `closed`, regenerates cockpit/data.js, and leaves the changes for
// the workflow step to commit and push to the branch. The merge then carries
// the derived state into main: no post-merge push, no ruleset bypass. If the
// gates are not green the flip is reverted — the scribe never closes an
// iteration that isn't done. Never run ad hoc: derived state has exactly one
// writer.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, readText, writeText } from "./lib.ts";

const checksDir = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? process.cwd();

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || !existsSync(eventPath)) {
  console.log("scribe: no GitHub event context — no-op (derived state has one writer: this script, in CI)");
  process.exit(0);
}
const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
  action?: string;
  pull_request?: { head?: { ref?: string } };
};
if (event.action === "closed") {
  console.log("scribe: PR closed — closure state rides the merge, nothing to do");
  process.exit(0);
}
const branch = event.pull_request?.head?.ref ?? "";
if (!branch.startsWith("iteration/")) {
  console.log(`scribe: branch '${branch}' is not an iteration — no-op`);
  process.exit(0);
}
const id = branch.slice("iteration/".length);

const registryPath = "manifest-of-iterations.json";
const dataPath = "cockpit/data.js";
const registry = readJson<{ iterations: { id: string; status: string }[] }>(root, registryPath);
const entry = registry.iterations.find((e) => e.id === id);
if (!entry) {
  console.log(`scribe: no registry entry for '${id}' — no-op`);
  process.exit(0);
}
if (entry.status !== "open") {
  console.log(`scribe: '${id}' is already ${entry.status} — no-op`);
  process.exit(0);
}

// Snapshot what we might need to restore on a not-ready outcome.
const originalRegistry = readText(root, registryPath);
const hadData = existsSync(join(root, dataPath));
const originalData = hadData ? readText(root, dataPath) : null;

entry.status = "closed";
writeText(root, registryPath, JSON.stringify(registry, null, 2) + "\n");
spawnSync(process.execPath, [join(checksDir, "cockpit-report.ts"), root], {
  encoding: "utf8",
  stdio: "inherit",
});

// Fail closed: keep the flip only if every gate is green with it in place.
// On the PR branch the carrying merge does not exist yet — scores-check
// defers trace reconciliation to main in that context (GITHUB_EVENT_NAME).
const verdict = (script: string): number =>
  spawnSync(process.execPath, [join(checksDir, script), root], {
    encoding: "utf8",
    stdio: "inherit",
  }).status ?? 1;

if (verdict("manifest-sync.ts") !== 0 || verdict("scores-check.ts") !== 0) {
  writeText(root, registryPath, originalRegistry);
  if (hadData && originalData !== null) writeText(root, dataPath, originalData);
  console.log(`scribe: '${id}' is not ready to close (gates not green) — reverted, retried on next push`);
  process.exit(0);
}

console.log(`scribe: closed '${id}' — registry + cockpit/data.js ready to commit and push`);
