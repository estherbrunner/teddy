// Scribe: the deterministic writer of derived state (adr/0003). Runs in CI on
// `pull_request.closed`: when a merged PR's branch is `iteration/<id>`, it
// flips the registry entry to `closed`, regenerates cockpit/data.js, and
// verifies the gates before the workflow step commits and pushes. Never run
// ad hoc by agents or humans — derived state has exactly one writer.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeText } from "./lib.ts";

const checksDir = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ?? process.cwd();

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || !existsSync(eventPath)) {
  console.log("scribe: no GitHub event context — no-op (derived state has one writer: this script, in CI)");
  process.exit(0);
}
const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
  pull_request?: { merged?: boolean; head?: { ref?: string } };
};
const pr = event.pull_request;
if (!pr || pr.merged !== true) {
  console.log("scribe: PR was closed without merging — nothing to record");
  process.exit(0);
}
const branch = pr.head?.ref ?? "";
if (!branch.startsWith("iteration/")) {
  console.log(`scribe: branch '${branch}' is not an iteration — no-op`);
  process.exit(0);
}
const id = branch.slice("iteration/".length);

const registryPath = "manifest-of-iterations.json";
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
entry.status = "closed";
writeText(root, registryPath, JSON.stringify(registry, null, 2) + "\n");

// Regenerate cockpit data, then verify the gates fail closed: the scribe must
// not push an inconsistent tree.
const check = (script: string): number =>
  spawnSync(process.execPath, [join(checksDir, script), root], {
    encoding: "utf8",
    stdio: "inherit",
  }).status ?? 1;

if (check("cockpit-report.ts") !== 0) process.exit(1);
if (check("manifest-sync.ts") !== 0) process.exit(1);
if (check("scores-check.ts") !== 0) process.exit(1);

console.log(`scribe: closed '${id}' — registry + cockpit/data.js ready to commit and push`);
