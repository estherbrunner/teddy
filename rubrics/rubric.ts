// Teddy's rubric (adr/0006, v2). Criteria carry deterministic evidence —
// gates (checks/<id>.ts, binary, hard) and signals (numeric, thresholded) —
// and, where judge is "llm", anchors the judge scores against. This module
// is validated by tsc and by checks/lib.ts#validateRubric; it may import
// nothing but its own type (manifest-sync enforces that).
import type { Rubric } from "../checks/lib.ts";

export default {
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
  adrs: {
    "0001-teddy-bootstrap": ["adr-traceability"],
    "0002-cockpit-minimal-scope": ["cockpit-clarity"],
    "0003-github-native-approval": ["adr-traceability"],
    "0004-lint-gate": [],
    "0005-derived-state-is-never-stored": ["adr-traceability"],
    "0006-rubric-v2-evidence-and-judge": ["adr-traceability"],
  },
} satisfies Rubric;
