window.__TEDDY_DATA__ = {
  "version": 1,
  "generated_by": "checks/cockpit-report.ts",
  "repository": "https://github.com/estherbrunner/teddy",
  "rubric": {
    "version": 1,
    "criteria": [
      {
        "id": "adr-traceability",
        "description": "Every accepted ADR has ≥1 linked assertion or rubric criterion",
        "weight": 2,
        "judge": "manifest-sync"
      },
      {
        "id": "cockpit-clarity",
        "description": "Dashboard surfaces trend, ADR status, and judge/deterministic ratio without extra clicks",
        "weight": 1,
        "judge": "llm"
      },
      {
        "id": "loop-closure",
        "description": "Disagreements between judge and human resolve into an ADR amendment or promoted assertion within one iteration",
        "weight": 3,
        "judge": "llm"
      }
    ]
  },
  "adrs": [
    {
      "id": "0001-teddy-bootstrap",
      "status": "accepted",
      "assertions": [
        "checks/manifest-sync.ts",
        "checks/scores-check.ts",
        "checks/selftest.ts"
      ],
      "criteria": [
        "adr-traceability"
      ]
    },
    {
      "id": "0002-cockpit-minimal-scope",
      "status": "accepted",
      "assertions": [
        "checks/cockpit-report.ts"
      ],
      "criteria": [
        "cockpit-clarity"
      ]
    },
    {
      "id": "0003-github-native-approval",
      "status": "accepted",
      "assertions": [
        "checks/manifest-sync.ts",
        "checks/scores-check.ts",
        "checks/scribe.ts"
      ],
      "criteria": [
        "adr-traceability"
      ]
    }
  ],
  "iterations": [
    {
      "id": "0001-teddy-bootstrap",
      "baseline": null,
      "status": "closed",
      "timestamp": "2026-09-11T09:00:00Z",
      "overall": 1,
      "deterministic_gate": "pass",
      "judge_surface": {
        "deterministic": 1,
        "total": 1
      },
      "criteria": {
        "adr-traceability": {
          "score": 1,
          "judge": "manifest-sync",
          "rationale": "checks/manifest-sync.ts passes: both ADRs resolve to linked assertions/criteria, no orphaned ADRs or assertions, rubric.yaml agrees with manifest.json; gate verified to reject unapproved transitions and orphans by checks/selftest.ts"
        },
        "cockpit-clarity": {
          "score": null,
          "judge": "llm",
          "rationale": "not exercised — the cockpit does not exist until iteration 0002"
        },
        "loop-closure": {
          "score": null,
          "judge": "llm",
          "rationale": "not exercised — no judge/human disagreement cycle has occurred yet"
        }
      }
    },
    {
      "id": "0002-cockpit-minimal-scope",
      "baseline": "0001-teddy-bootstrap",
      "status": "closed",
      "timestamp": "2026-09-11T10:00:00Z",
      "overall": 1,
      "deterministic_gate": "pass",
      "judge_surface": {
        "deterministic": 1,
        "total": 2
      },
      "criteria": {
        "adr-traceability": {
          "score": 1,
          "judge": "manifest-sync",
          "rationale": "checks/manifest-sync.ts passes with cockpit-report.ts linked to adr/0002; no orphans introduced"
        },
        "cockpit-clarity": {
          "score": 1,
          "judge": "llm",
          "rationale": "cockpit/main.ts render() draws the overall trend with baseline delta, per-criterion small multiples with hover rationales, the ADR status table with pending-approval chips, and the judge-surface bars — all on one page with no navigation (criterion's literal terms). Self-judged at bootstrap; subject to human review on merge — a downgrade here would trigger the loop-closure path"
        },
        "loop-closure": {
          "score": null,
          "judge": "llm",
          "rationale": "not exercised — no judge/human disagreement cycle has occurred yet"
        }
      }
    },
    {
      "id": "0003-loop-closure",
      "baseline": "0002-cockpit-minimal-scope",
      "status": "closed",
      "timestamp": "2026-09-11T19:52:33Z",
      "overall": 1,
      "deterministic_gate": "pass",
      "judge_surface": {
        "deterministic": 1,
        "total": 2
      },
      "criteria": {
        "adr-traceability": {
          "score": 1,
          "judge": "manifest-sync",
          "rationale": "checks/manifest-sync.ts passes: both accepted ADRs resolve to linked assertions/criteria, the amendment adds no unlinked artifacts, scores-check remains the promoted assertion for adr/0001"
        },
        "cockpit-clarity": {
          "score": null,
          "judge": "llm",
          "rationale": "not exercised — no cockpit change this iteration"
        },
        "loop-closure": {
          "score": 1,
          "judge": "llm",
          "rationale": "the gate-comparability defect flagged during bootstrap review (and concurred by the human) resolved within one iteration into both halves of the fork: adr/0001 amendment section 'paired per-criterion baseline gate' AND promotion into checks/scores-check.ts (chain-walk) with selftest cases F1/F2 proving the old gate's escape now passes and compensated regressions still fail. Structural evidence, checkable in the diff. If human review downgrades this score, that disagreement itself becomes the next loop-closure datum"
        }
      }
    },
    {
      "id": "0004-github-native-approval",
      "baseline": "0003-loop-closure",
      "status": "closed",
      "timestamp": "2026-09-11T20:48:39Z",
      "overall": 1,
      "deterministic_gate": "pass",
      "judge_surface": {
        "deterministic": 1,
        "total": 2
      },
      "criteria": {
        "adr-traceability": {
          "score": 1,
          "judge": "manifest-sync",
          "rationale": "checks/manifest-sync.ts passes: 3 ADRs resolve with manifest↔rubric parity and no orphans; accepted ADRs reconcile against merge history (grandfathered 0001/0002 per adr/0003); legacy approved_by rejected by both schema guards — verified in both directions by the 19-case selftest (git-backed fixtures)"
        },
        "cockpit-clarity": {
          "score": 1,
          "judge": "llm",
          "rationale": "cockpit/main.ts keeps trend, ADR status, and judge-surface ratio on the single page and now renders the approval column as merge state (merged ✓ for accepted; ⚠ review & merge ↗ deep-linking to the repository's PR queue for pending items, per adr/0003) — no extra clicks. Self-judged pending human review; a downgrade here is the next loop-closure datum"
        },
        "loop-closure": {
          "score": null,
          "judge": "llm",
          "rationale": "not exercised — adr/0003 was a directed design decision, not a judge/human disagreement"
        }
      }
    }
  ]
};
