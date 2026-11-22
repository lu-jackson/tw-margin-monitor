"use strict";
/* Top summary: one verdict, three numbers, one caveat. Derived from data/latest.json; the detailed per-equation
   outputs stay in the equation table further down. Follows the RESEARCH/LATEST toggle of that table. */
(function () {
  const host = document.getElementById("summary");
  if (!host) return;
  const f = (x, d = 2) => Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sg = (x, d = 2) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const r0 = x => (Math.round(x) > 0 ? "+" : Math.round(x) < 0 ? "−" : "") + Math.abs(Math.round(x));
  const rng = a => { if (!a.length) return null; const lo = Math.min(...a), hi = Math.max(...a); return Math.round(lo) === Math.round(hi) ? r0(lo) : `${r0(lo)} ~ ${r0(hi)}`; };
  let L = null;
  const basis = () => ((document.querySelector("#basis button.on") || {}).dataset || {}).b || "research";

  function render() {
    const b = basis(), ev = L.scenarios[b], M = L.margin, V = b === "research" ? L.vix_research : L.vix_latest;
    const low = M.L145 === 1, elev = V.signal;
    const horizonOf = Object.fromEntries(L.scenario_meta.scenarios.map(s => [s.id, s.horizon]));
    const by = h => ev.filter(e => h.includes(horizonOf[e.id])).map(e => e.total_pp);
    const cells = [{ k: "20D", v: by([20]) }, { k: "60D", v: by([60]) }, { k: "120–250D", v: by([120, 250]) }];
    const active = cells.some(c => c.v.some(x => x !== 0));

    let tone, title, sub;
    if (low && elev) { tone = "dn"; title = "DUAL STRESS"; sub = "Low margin + elevated VIX"; }
    else if (low) { tone = "dn"; title = "LOW MARGIN"; sub = "Margin ratio below 145%"; }
    else if (elev) { tone = "am"; title = "ELEVATED VIX"; sub = "Fear rising; margin ratio still above 145%"; }
    else { tone = "mu"; title = "NEUTRAL"; sub = "No signal active"; }

    const facts = `Margin <b>${f(M.M, 1)}%</b>${low ? " (&lt;145)" : ""} · VIX <b>${f(V.close, 1)}</b> (zV ${sg(V.zV)})`;
    const stat = c => {
      const t = rng(c.v);
      const pos = c.v.length && Math.min(...c.v) >= 0;
      return `<div class="st"><div class="stk">${c.k}</div><div class="stv ${active ? (pos ? "up" : "dn") : "mu"}">${active && t ? t : "0"}<i>pp</i></div></div>`;
    };

    host.innerHTML =
      `<div class="s-verdict"><div class="s-title ${tone}">${title}</div><div class="s-sub">${sub}</div><div class="s-facts">${facts}</div></div>` +
      `<div class="s-stats"><div class="s-cap">${active ? "After similar readings in the past, 2× long earned on average vs. normal" : "No signal active — equation outputs are 0"}</div><div class="s-row">${active ? cells.map(stat).join("") : ""}</div></div>` +
      `<div class="s-note"><div><b>In-sample historical average</b>, not a forecast</div><div>Low-margin episodes: only ~4–5</div><div><span>VIX basis: ${b === "research" ? "Research (T−1)" : "Latest close"}</span></div></div>`;
  }

  fetch("data/latest.json", { cache: "no-store" }).then(r => r.json()).then(d => {
    L = d; render();
    const bs = document.getElementById("basis");
    if (bs) bs.addEventListener("click", () => render());   // registered after app.js, toggle state already updated
  }).catch(() => { host.innerHTML = ""; });
})();
