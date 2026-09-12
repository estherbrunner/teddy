// Deterministic test gate (adr/0006 adapter): detects the test runner
// declared in package.json — vitest, jest, mocha — in fixed priority order
// and runs its lockfile-pinned local binary. With no declared runner, falls
// back to `node --test` when test files exist; otherwise skips with a note.
// Declared but not installed → fail closed.
// Usage: node checks/test.ts [--json] [root]
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { declaredDeps, emitResult, localBin, runTool } from "./lib.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
const log = (msg: string): void => (json ? console.error(msg) : console.log(msg));

const RUNNERS = [
  { pkg: "vitest", bin: "vitest", args: ["run"] },
  { pkg: "jest", bin: "jest", args: ["--ci"] },
  { pkg: "mocha", bin: "mocha", args: [] },
];

// node --test's discovery patterns, applied by hand so the harness's own
// checks/ directory (checks/test.ts would match `**/test.*`) is excluded and
// the files can be passed explicitly.
const TEST_FILE = /(^test|[.\-_]test|^test-.*)\.(m?js|cjs|ts|mts|cts)$/;
const SOURCE = /\.(m?js|cjs|ts|mts|cts)$/;
function nodeTestFiles(dir: string, rel = "", inTestDir = false, depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (depth === 0 && (name === "checks" || name === "cockpit" || name === "coverage")) continue;
    const full = join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) {
      out.push(...nodeTestFiles(full, relPath, inTestDir || name === "test" || name === "tests", depth + 1));
    } else if (TEST_FILE.test(name) || (inTestDir && SOURCE.test(name))) {
      out.push(relPath);
    }
  }
  return out;
}

let deps: Record<string, string>;
try {
  deps = declaredDeps(root);
} catch (e) {
  console.error(`FAIL: test: package.json is not valid JSON: ${(e as Error).message}`);
  emitResult("test", "fail", json);
}

const detected = RUNNERS.find((r) => r.pkg in deps);
if (detected) {
  const bin = localBin(root, detected.bin);
  if (!bin) {
    console.error(`FAIL: test: '${detected.pkg}' declared in package.json but not installed — run: npm install`);
    emitResult("test", "fail", json);
  }
  log(`test: running ${detected.bin} (${detected.pkg})`);
  const res = runTool(root, bin, detected.args, json);
  if (res.status !== 0) {
    console.error(`FAIL: test: ${detected.bin} failed (exit code ${res.status ?? res.signal})`);
    emitResult("test", "fail", json);
  }
  log(`test: OK (${detected.pkg})`);
  emitResult("test", "pass", json);
}

const files = nodeTestFiles(root);
if (files.length > 0) {
  log(`test: no runner declared — running node --test over ${files.length} file(s)`);
  const res = runTool(root, process.execPath, ["--test", ...files], json);
  if (res.status !== 0) {
    console.error(`FAIL: test: node --test failed (exit code ${res.status ?? res.signal})`);
    emitResult("test", "fail", json);
  }
  log("test: OK (node --test)");
  emitResult("test", "pass", json);
}

log("test: no test runner declared and no test files found — test gate skipped");
emitResult("test", "skip", json);
