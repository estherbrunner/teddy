#!/usr/bin/env node
// teddy <command> [--json|--check] [root]  (adr/0007)
//   check                 manifest-sync + scores-check + report --check — the CI gate
//   report                write <root>/cockpit/ (data.js + dashboard)
//   judge                 score the open iteration on this branch (adr/0006; local, needs a credential for llm criteria)
//   <check-id>            run a check: a host checks/<id>.ts or a built-in
//                         (manifest-sync, scores-check, lint, typecheck, test, coverage)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_EXT, listBuiltinChecks, loadConfig, resolveCheck } from "./lib.ts";

const here = dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();

function run(script: string, args: string[]): number {
  const res = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  return res.status ?? 1;
}

function usage(): never {
  const builtins = listBuiltinChecks().join(", ");
  console.error(`usage: teddy <check | report | judge | ${builtins}> [--json|--check|--verify|--dry-run] [root]`);
  process.exit(2);
}

if (!command || command.startsWith("-")) usage();

if (command === "report" || command === "judge") {
  process.exit(run(join(here, "commands", `${command}${BUILTIN_EXT}`), rest));
}

if (command === "check") {
  const cfg = await loadConfig(root);
  for (const id of ["manifest-sync", "scores-check"]) {
    const script = resolveCheck(root, cfg, id);
    if (!script) {
      console.error(`teddy: built-in check '${id}' missing`);
      process.exit(1);
    }
    const code = run(script, [root]);
    if (code !== 0) process.exit(code);
  }
  process.exit(run(join(here, "commands", `report${BUILTIN_EXT}`), ["--check", root]));
}

const cfg = await loadConfig(root);
const script = resolveCheck(root, cfg, command);
if (!script || !existsSync(script)) {
  console.error(`teddy: unknown command or check '${command}'`);
  usage();
}
process.exit(run(script, rest));
