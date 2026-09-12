// Deterministic typecheck gate (adr/0006 adapter): runs the lockfile-pinned
// local `tsc --noEmit` when `typescript` is declared in package.json. Not
// declared → skip with a note; declared but not installed → fail closed.
// Usage: node checks/typecheck.ts [--json] [root]
import { declaredDeps, emitResult, localBin, runTool } from "../lib.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const log = (msg: string): void => (json ? console.error(msg) : console.log(msg));

let deps: Record<string, string>;
try {
  deps = declaredDeps(root);
} catch (e) {
  console.error(`FAIL: typecheck: package.json is not valid JSON: ${(e as Error).message}`);
  emitResult("typecheck", "fail", json);
}
if (!("typescript" in deps)) {
  log("typecheck: 'typescript' not declared in package.json — typecheck gate skipped");
  emitResult("typecheck", "skip", json);
}
const bin = localBin(root, "tsc");
if (!bin) {
  console.error("FAIL: typecheck: 'typescript' declared but not installed — run: npm install");
  emitResult("typecheck", "fail", json);
}
log("typecheck: running tsc --noEmit");
const res = runTool(root, bin, ["--noEmit"], json);
if (res.status !== 0) {
  console.error(`FAIL: typecheck: tsc failed (exit code ${res.status ?? res.signal})`);
  emitResult("typecheck", "fail", json);
}
log("typecheck: OK");
emitResult("typecheck", "pass", json);
