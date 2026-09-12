// Teddy's own configuration (adr/0007) — Teddy is its own first host. The
// directories are the defaults; the rubric is Teddy's (adr/0006). This
// module may import nothing but its type (manifest-sync enforces that).
import type { Config } from "./src/lib.ts";

export default {
  src: ["src/**"],
  rubric: {
    version: 2,
    tolerance: 0.1,
    criteria: [
      {
        id: "adr-traceability",
        description: "Every accepted ADR has ≥1 linked assertion or rubric criterion, and the harness's own gates are green",
        weight: 2,
        gates: ["manifest-sync", "selftest", "typecheck", "lint"],
        signals: [],
        judge: "none",
      },
      {
        id: "cockpit-clarity",
        description: "Dashboard surfaces trend, ADR status, and judge/deterministic ratio without extra clicks",
        weight: 1,
        gates: [],
        signals: [],
        judge: "llm",
        anchors: {
          0: "A reader must navigate, hover, or open another file to learn the trend, an ADR's status, or the judge surface.",
          0.5: "Trend, ADR status, and judge surface are on the page, but one of them needs a hover or a second look to read (e.g. no baseline delta, no PR link on a pending item).",
          1: "Trend with baseline delta, every ADR's status and its merge/review link, and the judge-surface ratio are readable on one screen at a glance.",
        },
      },
      {
        id: "loop-closure",
        description: "Disagreements between judge and human resolve into an ADR amendment or promoted assertion within one iteration",
        weight: 3,
        gates: [],
        signals: [],
        judge: "llm",
        anchors: {
          0: "A recorded judge/human disagreement is still open after the following iteration, or was resolved by editing the score.",
          0.5: "The disagreement was resolved within one iteration, but only by prose (ticket, PR comment) — no ADR amendment and no new assertion.",
          1: "The disagreement resolved within one iteration into an ADR amendment or a promoted deterministic assertion, checkable in the diff.",
        },
      },
    ],
  },
} satisfies Config;
