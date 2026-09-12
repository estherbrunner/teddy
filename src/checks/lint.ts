// Deterministic lint gate (adr/0004): `npm run lint` detects the linter
// declared in package.json and runs its lockfile-pinned local binary with a
// fixed argument set. No declared linter → explicit skip (the declaration is
// the configuration). Declared but not installed, unparseable package.json,
// or lint findings → exit 1: the gate fails closed on verification, not on
// absence. Honours the --json check contract (adr/0006).
// Usage: node checks/lint.ts [--json] [root]
import { declaredDeps, emitResult, localBin, runTool } from "../lib.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const log = (msg: string): void => (json ? console.error(msg) : console.log(msg));

// Fixed priority order; the first linter declared in package.json wins.
const LINTERS = [
  { pkg: "@biomejs/biome", bin: "biome", args: ["check", "."] },
  { pkg: "eslint", bin: "eslint", args: ["."] },
  { pkg: "oxlint", bin: "oxlint", args: ["."] },
  { pkg: "standard", bin: "standard", args: [] },
  { pkg: "xo", bin: "xo", args: [] },
];

let deps: Record<string, string>;
try {
  deps = declaredDeps(root);
} catch (e) {
  console.error(`FAIL: lint: package.json is not valid JSON: ${(e as Error).message}`);
  emitResult("lint", "fail", json);
}

const detected = LINTERS.find((l) => l.pkg in deps);
if (!detected) {
  log("lint: no supported linter declared in package.json — lint gate skipped (adr/0004)");
  emitResult("lint", "skip", json);
}

// The local install, never a resolver that could reach the network.
const bin = localBin(root, detected.bin);
if (!bin) {
  console.error(`FAIL: lint: '${detected.pkg}' declared in package.json but not installed — run: npm install`);
  emitResult("lint", "fail", json);
}

log(`lint: running ${detected.bin} (${detected.pkg})`);
const res = runTool(root, bin, detected.args, json);
if (res.status !== 0) {
  const why = res.status === null ? `terminated by ${res.signal}` : `exit code ${res.status}`;
  console.error(`FAIL: lint: ${detected.bin} failed (${why})`);
  emitResult("lint", "fail", json);
}
log(`lint: OK (${detected.pkg})`);
emitResult("lint", "pass", json);
