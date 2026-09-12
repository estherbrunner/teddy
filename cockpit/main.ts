// Teddy cockpit — static reader over precomputed data (adr/0002).
// Everything in one file: tsc emits the single main.js loaded by index.html.
// The only math here is pixel positions; ranking/aggregation lives in
// checks/cockpit-report.ts (adr/0001: no aggregation logic duplicated).

interface CriterionScore {
  score: number | null;
  judge: string;
  rationale: string;
}
interface Iteration {
  id: string;
  baseline: string | null;
  status: string;
  pr: number | null;
  timestamp: string;
  overall: number;
  deterministic_gate: string;
  judge_surface: { deterministic: number; total: number };
  criteria: Record<string, CriterionScore>;
}
interface Adr {
  id: string;
  status: string;
  assertions: string[];
  criteria: string[];
}
interface RubricCriterion {
  id: string;
  description: string;
  weight: number;
  judge: string;
  gates: string[];
  signals: string[];
}
interface TeddyData {
  version: number;
  generated_by: string;
  repository: string | null;
  rubric: { version: number; criteria: RubricCriterion[] };
  adrs: Adr[];
  iterations: Iteration[];
}

const data = (window as unknown as { __TEDDY_DATA__: TeddyData }).__TEDDY_DATA__;
const app = document.getElementById("app") as HTMLElement;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(name: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function section(title: string, hint?: string): { root: HTMLElement; body: HTMLElement } {
  const root = el("section");
  root.appendChild(el("h2", undefined, title));
  if (hint) root.appendChild(el("div", "hint", hint));
  const body = el("div");
  root.appendChild(body);
  return { root, body };
}

// One line chart; null scores create gaps. Domain fixed to [0, 1].
function lineChart(
  values: (number | null)[],
  labels: string[],
  tooltips: string[],
  w: number,
  h: number,
): SVGElement {
  const padL = 30;
  const padR = 10;
  const padT = 8;
  const padB = 18;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const svg = svgEl("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img" });
  const x = (i: number): number => padL + (values.length === 1 ? iw / 2 : (i / (values.length - 1)) * iw);
  const y = (v: number): number => padT + (1 - v) * ih;

  for (const g of [0, 0.5, 1]) {
    svg.appendChild(svgEl("line", {
      x1: padL, x2: w - padR, y1: y(g), y2: y(g),
      stroke: "#262b36", "stroke-width": 1,
    }));
    const t = svgEl("text", { x: padL - 6, y: y(g) + 3, "text-anchor": "end", fill: "#566072", "font-size": 9 });
    t.textContent = fmt(g);
    svg.appendChild(t);
  }

  let run: { i: number; v: number }[] = [];
  const flush = (): void => {
    if (run.length >= 2) {
      svg.appendChild(svgEl("polyline", {
        points: run.map((p) => `${x(p.i)},${y(p.v)}`).join(" "),
        fill: "none", stroke: "#6ea8fe", "stroke-width": 2, "stroke-linejoin": "round",
      }));
    }
    run = [];
  };
  values.forEach((v, i) => {
    if (v === null) {
      flush();
      return;
    }
    run.push({ i, v });
    const dot = svgEl("circle", { cx: x(i), cy: y(v), r: 3.5, fill: "#6ea8fe" });
    const tip = svgEl("title");
    tip.textContent = tooltips[i]
      ? `${labels[i]}: ${fmt(v)} — ${tooltips[i]}`
      : `${labels[i]}: ${fmt(v)}`;
    dot.appendChild(tip);
    svg.appendChild(dot);
  });
  flush();

  if (labels.length > 1) {
    const t = svgEl("text", { x: padL, y: h - 4, fill: "#566072", "font-size": 9 });
    t.textContent = labels[0];
    svg.appendChild(t);
    const t2 = svgEl("text", { x: w - padR, y: h - 4, "text-anchor": "end", fill: "#566072", "font-size": 9 });
    t2.textContent = labels[labels.length - 1];
    svg.appendChild(t2);
  }
  return svg;
}

function shortId(id: string): string {
  return id.split("-")[0];
}

function render(): void {
  if (!data || !Array.isArray(data.iterations) || data.iterations.length === 0) {
    app.appendChild(el("p", "empty", "No iterations recorded yet."));
    return;
  }
  const its = data.iterations;
  const latest = its[its.length - 1];

  const header = el("header");
  header.appendChild(el("h1", undefined, "Teddy cockpit"));
  header.appendChild(el("div", "sub", `TS Eval-Driven Development — ${its.length} iteration(s), latest ${latest.id} · ${latest.timestamp.slice(0, 10)}`));
  app.appendChild(header);

  const bigrow = el("div", "bigrow");
  bigrow.appendChild(el("div", "big", fmt(latest.overall)));
  const base = latest.baseline ? its.find((i) => i.id === latest.baseline) : undefined;
  if (base) {
    const d = latest.overall - base.overall;
    const cls = d > 0 ? "up" : d < 0 ? "down" : "flat";
    const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "＝";
    bigrow.appendChild(el("div", `delta ${cls}`, `${arrow} ${d >= 0 ? "+" : ""}${fmt(d)} vs baseline ${shortId(base.id)} (gate: must not decrease)`));
  } else {
    bigrow.appendChild(el("div", "delta flat", "first iteration — no baseline"));
  }
  bigrow.appendChild(el("span", `chip ${latest.deterministic_gate === "pass" ? "accepted" : "pending"}`, `deterministic gate: ${latest.deterministic_gate}`));
  // adr/0005 (amended): the PR is read off the merge commit, never stored —
  // closed iterations link to it; open ones are found by their branch name.
  if (data.repository) {
    const link = document.createElement("a");
    if (latest.pr !== null) {
      link.href = `${data.repository}/pull/${latest.pr}`;
      link.textContent = `merged in #${latest.pr} ↗`;
    } else {
      link.href = `${data.repository}/pulls?q=${encodeURIComponent(`is:pr head:iteration/${latest.id}`)}`;
      link.textContent = "review & merge ↗";
    }
    bigrow.appendChild(link);
  }
  app.appendChild(bigrow);

  // 1 — overall trend
  {
    const s = section("Overall score", "weighted mean over non-null criteria · nulls excluded");
    s.body.appendChild(lineChart(
      its.map((i) => i.overall),
      its.map((i) => shortId(i.id)),
      its.map((i) => `${i.overall}`),
      900, 130,
    ));
    s.body.querySelector("svg")?.setAttribute("width", "100%");
    app.appendChild(s.root);
  }

  // 2 — per-criterion small multiples
  {
    const s = section("Per-criterion", "hover a dot for the recorded rationale");
    const grid = el("div", "multiples");
    for (const c of data.rubric.criteria) {
      const mini = el("div", "mini");
      const t = el("div", "t");
      t.appendChild(el("span", "id", c.id));
      const vals = its.map((i) => i.criteria[c.id]?.score ?? null);
      const lastVal = [...vals].reverse().find((v) => v !== null) ?? null;
      t.appendChild(el("span", "val", lastVal === null ? "not exercised" : fmt(lastVal)));
      mini.appendChild(t);
      const evidence = [...c.gates, ...c.signals];
      mini.appendChild(el("div", "meta", `weight ${c.weight} · judge ${c.judge}${evidence.length ? ` · evidence ${evidence.join(", ")}` : ""}`));
      mini.appendChild(lineChart(
        vals,
        its.map((i) => shortId(i.id)),
        its.map((i) => i.criteria[c.id]?.rationale ?? ""),
        260, 90,
      ));
      mini.querySelector("svg")?.setAttribute("width", "100%");
      grid.appendChild(mini);
    }
    s.body.appendChild(grid);
    app.appendChild(s.root);
  }

  // 3 — ADR status table
  {
    const s = section("Decision records", "any ADR without an approver is pending — never auto-approved");
    const table = el("table");
    const head = el("tr");
    for (const h of ["ADR", "status", "approval", "links"]) head.appendChild(el("th", undefined, h));
    const thead = document.createElement("thead");
    thead.appendChild(head);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const a of data.adrs) {
      const tr = el("tr");
      const td1 = el("td");
      const link = document.createElement("a");
      link.href = `../adr/${a.id}.md`;
      link.textContent = a.id;
      td1.appendChild(link);
      tr.appendChild(td1);
      const td2 = el("td");
      const dead = a.status === "deprecated" || a.status === "superseded";
      td2.appendChild(el("span", `chip ${a.status === "accepted" ? "accepted" : dead ? "dead" : "pending"}`, a.status));
      tr.appendChild(td2);
      const td3 = el("td");
      // adr/0003: approval is the merge — pending items deep-link to review.
      if (a.status === "accepted") {
        td3.appendChild(el("span", "chip accepted", "merged ✓"));
        td3.title = "merge = approval (adr/0003)";
      } else if (dead) {
        td3.appendChild(el("span", "chip dead", "—"));
      } else if (data.repository) {
        const review = document.createElement("a");
        review.href = `${data.repository}/pulls`;
        review.textContent = "⚠ review & merge ↗";
        td3.appendChild(review);
      } else {
        td3.appendChild(el("span", "chip pending", "⚠ pending"));
      }
      tr.appendChild(td3);
      const td4 = el("td");
      td4.appendChild(el("span", undefined,
        `${a.criteria.length} criterion(a) · ${a.assertions.length} assertion(s)`));
      td4.style.color = "var(--muted)";
      tr.appendChild(td4);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    s.body.appendChild(table);
    app.appendChild(s.root);
  }

  // 4 — judge surface over time
  {
    const s = section("Judge surface", "weight of exercised criteria scored deterministically (judge none) over exercised weight — should approach 1 as judgments get promoted");
    for (const it of its) {
      const row = el("div", "jrow");
      row.appendChild(el("span", "lbl", it.id));
      const bar = el("div", "bar");
      const fill = el("div");
      const pct = it.judge_surface.total === 0 ? 0 : (it.judge_surface.deterministic / it.judge_surface.total) * 100;
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el("span", undefined,
        it.judge_surface.total === 0 ? "—" : `${it.judge_surface.deterministic}/${it.judge_surface.total}`));
      row.title = `${it.id}: ${it.judge_surface.deterministic} of ${it.judge_surface.total} exercised criteria deterministically judged`;
      s.body.appendChild(row);
    }
    app.appendChild(s.root);
  }

  app.appendChild(el("footer", undefined, `${data.generated_by} · static reader — data precomputed, no aggregation here (adr/0001, adr/0002)`));
}

render();
