// Deterministic judge for the 'cockpit-surface' criterion (adr/0005): the
// cockpit must structurally surface three things on a single page — the
// score trend, ADR statuses, and the judge/deterministic ratio — reading
// nothing but the precomputed data file. Verifies the actual artifacts
// (cockpit/data.js, cockpit/index.html, cockpit/main.ts) offline: no DOM,
// no browser, no network.
// Usage: node checks/cockpit-surface.ts [root]
import { ADR_STATUSES, readText } from "./lib.ts";

const root = process.argv[2] ?? process.cwd();
const fails: string[] = [];
function fail(msg: string): void {
  fails.push(msg);
}

// 1. data.js — the precomputed surfaces themselves.
interface SurfaceIteration {
  overall?: unknown;
  judge_surface?: { deterministic?: unknown; total?: unknown };
}
interface SurfaceAdr {
  id?: unknown;
  status?: unknown;
}
let iterations: SurfaceIteration[] = [];
let adrs: SurfaceAdr[] = [];
try {
  const raw = readText(root, "cockpit/data.js");
  const data = JSON.parse(
    raw.replace(/^window\.__TEDDY_DATA__ = /, "").replace(/;\n?$/, ""),
  ) as { iterations?: SurfaceIteration[]; adrs?: SurfaceAdr[] };
  iterations = Array.isArray(data.iterations) ? data.iterations : [];
  adrs = Array.isArray(data.adrs) ? data.adrs : [];
} catch (e) {
  fail(`cockpit/data.js unreadable: ${(e as Error).message}`);
}
if (iterations.length === 0) fail("cockpit/data.js: no iterations — trend cannot render");
for (const [i, it] of iterations.entries()) {
  if (typeof it.overall !== "number" || it.overall < 0 || it.overall > 1) {
    fail(`cockpit/data.js: iterations[${i}].overall must be a number in [0, 1] (trend surface)`);
  }
  const js = it.judge_surface;
  if (
    !js ||
    typeof js.deterministic !== "number" ||
    typeof js.total !== "number" ||
    js.total < 1 ||
    js.deterministic < 0 ||
    js.deterministic > js.total
  ) {
    fail(
      `cockpit/data.js: iterations[${i}].judge_surface must be ` +
        `{deterministic ≥ 0, total ≥ 1, deterministic ≤ total} (ratio surface)`,
    );
  }
}
for (const [i, a] of adrs.entries()) {
  if (typeof a.id !== "string" || a.id === "") {
    fail(`cockpit/data.js: adrs[${i}].id missing`);
  }
  if (typeof a.status !== "string" || !ADR_STATUSES.includes(a.status as never)) {
    fail(
      `cockpit/data.js: adrs[${i}].status must be one of ${ADR_STATUSES.join(" | ")} ` +
        `(status surface)`,
    );
  }
}

// 2. index.html — one page, one root, the two committed scripts.
let html = "";
try {
  html = readText(root, "cockpit/index.html");
} catch {
  fail("cockpit/index.html missing");
}
if (html !== "") {
  const roots = html.match(/id="app"/g)?.length ?? 0;
  if (roots !== 1) {
    fail(`cockpit/index.html: exactly one #app root expected, found ${roots}`);
  }
  for (const src of ["data.js", "main.js"]) {
    if (!html.includes(`src="${src}"`)) {
      fail(`cockpit/index.html: missing <script src="${src}">`);
    }
  }
}

// 3. main.ts — the structural pins: single data source, trend chart, status
// and ratio rendering, and no navigation away from the single page. A
// refactor that breaks a pin fails here loudly — a conscious re-pin.
let main = "";
try {
  main = readText(root, "cockpit/main.ts");
} catch {
  fail("cockpit/main.ts missing");
}
if (main !== "") {
  for (const token of ["__TEDDY_DATA__", "lineChart", "overall", "judge_surface", "status"]) {
    if (!main.includes(token)) {
      fail(`cockpit/main.ts: missing structural pin '${token}'`);
    }
  }
  if (/location\.(href|assign)\s*=/.test(main)) {
    fail("cockpit/main.ts: navigation away from the single page (location assignment)");
  }
}

if (fails.length > 0) {
  for (const f of fails) console.error(`FAIL: ${f}`);
  console.error(`\ncockpit-surface: ${fails.length} failure(s)`);
  process.exit(1);
}
console.log(`cockpit-surface: OK (${iterations.length} iterations, ${adrs.length} ADRs surfaced)`);
