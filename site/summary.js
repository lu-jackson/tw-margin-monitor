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
    const cells = [{ k: "20 日", v: by([20]) }, { k: "60 日", v: by([60]) }, { k: "120–250 日", v: by([120, 250]) }];
    const active = cells.some(c => c.v.some(x => x !== 0));

    let tone, title, sub;
    if (low && elev) { tone = "dn"; title = "雙重壓力"; sub = "低維持率 ＋ VIX 偏高"; }
    else if (low) { tone = "dn"; title = "低維持率"; sub = "維持率已低於 145%"; }
    else if (elev) { tone = "am"; title = "VIX 偏高"; sub = "恐慌升溫，維持率尚在 145% 之上"; }
    else { tone = "mu"; title = "中性"; sub = "兩項訊號都沒啟動"; }

    const facts = `維持率 <b>${f(M.M, 1)}%</b>${low ? "（&lt;145）" : ""} · VIX <b>${f(V.close, 1)}</b>（zV ${sg(V.zV)}）`;
    const stat = c => {
      const t = rng(c.v);
      const pos = c.v.length && Math.min(...c.v) >= 0;
      return `<div class="st"><div class="stk">${c.k}</div><div class="stv ${active ? (pos ? "up" : "dn") : "mu"}">${active && t ? t : "0"}<i>pp</i></div></div>`;
    };

    host.innerHTML =
      `<div class="s-verdict"><div class="s-title ${tone}">${title}</div><div class="s-sub">${sub}</div><div class="s-facts">${facts}</div></div>` +
      `<div class="s-stats"><div class="s-cap">${active ? "歷史上類似讀數之後，2× 多單平均比平常多賺" : "目前沒有啟動的訊號，方程式輸出為 0"}</div><div class="s-row">${active ? cells.map(stat).join("") : ""}</div></div>` +
      `<div class="s-note"><b>樣本內歷史平均</b>，不是預測<br>低維持率事件僅約 4–5 段<br><span>VIX 口徑：${b === "research" ? "研究（T−1）" : "最新收盤"}</span></div>`;
  }

  fetch("data/latest.json", { cache: "no-store" }).then(r => r.json()).then(d => {
    L = d; render();
    const bs = document.getElementById("basis");
    if (bs) bs.addEventListener("click", () => render());   // registered after app.js, toggle state already updated
  }).catch(() => { host.innerHTML = ""; });
})();
