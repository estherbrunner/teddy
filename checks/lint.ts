// Deterministic lint gate (adr/0004): `npm run lint` detects the linter
// declared in package.json and runs its lockfile-pinned local binary with a
// fixed argument set. No declared linter → explicit skip (the declaration is
// the configuration). Declared but not installed, unparseable package.json,
// or lint findings → exit 1: the gate fails closed on verification, not on
// absence.
// Usage: node checks/lint.ts [root]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readText } from "./lib.ts";

const root = process.argv[2] ?? process.cwd();

// Fixed priority order; the first linter declared in package.json wins.
const LINTERS = [
  { pkg: "@biomejs/biome", bin: "biome", args: ["check", "."] },
  { pkg: "eslint", bin: "eslint", args: ["."] },
  { pkg: "oxlint", bin: "oxlint", args: ["."] },
  { pkg: "standard", bin: "standard", args: [] },
  { pkg: "xo", bin: "xo", args: [] },
];

let deps: Record<string, string> = {};
if (existsSync(join(root, "package.json"))) {
  try {
    const pkg = JSON.parse(readText(root, "package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch (e) {
    console.error(`FAIL: lint: package.json is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
}

const detected = LINTERS.find((l) => l.pkg in deps);
if (!detected) {
  console.log("lint: no supported linter declared in package.json — lint gate skipped (adr/0004)");
  process.exit(0);
}

// The local install, never a resolver that could reach the network.
const bin = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? `${detected.bin}.cmd` : detected.bin,
);
if (!existsSync(bin)) {
  console.error(
    `FAIL: lint: '${detected.pkg}' declared in package.json but not installed — run: npm install`,
  );
  process.exit(1);
}

console.log(`lint: running ${detected.bin} (${detected.pkg})`);
const res = spawnSync(bin, detected.args, { cwd: root, stdio: "inherit" });
if (res.status !== 0) {
  const why = res.status === null ? `terminated by ${res.signal}` : `exit code ${res.status}`;
  console.error(`FAIL: lint: ${detected.bin} failed (${why})`);
  process.exit(1);
}
console.log(`lint: OK (${detected.pkg})`);
