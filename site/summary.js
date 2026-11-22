"use strict";
/* Top-of-page output summary: a heat-map of every equation output plus a plain-language read-out.
   Everything is derived from data/latest.json (same numbers as the equation table); nothing typed by hand
   except the interpretation wording. Follows the RESEARCH/LATEST basis toggle of the equation table. */
(function () {
  const host = document.getElementById("summary");
  if (!host) return;
  const f = (x, d = 2) => Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sg = (x, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const rng = a => a.length ? (Math.min(...a) === Math.max(...a) ? sg(a[0]) : `${sg(Math.min(...a))} ~ ${sg(Math.max(...a))}`) : "—";
  let L = null;
  const basis = () => (document.querySelector("#basis button.on") || {}).dataset?.b || "research";

  const ROWS = [
    { key: "FULL", label: "全時期", en: "FULL 2009–25", ids: { 20: "FULL-20", 60: "FULL-60" } },
    { key: "P13", label: "2013 年後", en: "POST-2013", ids: { 20: "P13-20", 60: "P13-60", 120: "P13-120", 250: "P13-250" } },
    { key: "P18", label: "2018 年後", en: "POST-2018", ids: { 20: "P18-20", 60: "P18-60", 120: "P18-120" } },
    { key: "L5", label: "最近 5 年", en: "LAST 5Y", ids: { 20: "L5-20" } },
    { key: "EARLY", label: "早期 2009–12", en: "EARLY", ids: {} },
  ];
  const HZ = [20, 60, 120, 250];

  function render() {
    const b = basis(), ev = L.scenarios[b], M = L.margin, V = b === "research" ? L.vix_research : L.vix_latest;
    const out = id => { const e = ev.find(x => x.id === id); return e ? e.total_pp : null; };
    const meta = id => L.scenario_meta.scenarios.find(s => s.id === id);
    const low = M.L145 === 1, elev = V.signal;
    const all = ROWS.flatMap(r => Object.values(r.ids)).map(out).filter(v => v != null);
    const vmax = Math.max(10, ...all.map(Math.abs));

    // ---------- heat map ----------
    let t = `<table class="hm"><thead><tr><th></th>${HZ.map(h => `<th>${h}D</th>`).join("")}</tr></thead><tbody>`;
    ROWS.forEach(r => {
      t += `<tr><th class="rl">${r.label}<i>${r.en}</i></th>`;
      HZ.forEach(h => {
        const id = r.ids[h];
        if (!id) { t += `<td class="na" title="${r.key === "EARLY" ? "No stable signal in 2009–2012" : "No stable equation for this window/horizon (CI spans 0 or unstable)"}">·</td>`; return; }
        const v = out(id), s = meta(id), eq = s.terms.map(x => (x.var === "zV" ? "zV" : "[M<145]") + " " + sg(x.coef, 2)).join("  ");
        const a = Math.min(1, Math.abs(v) / vmax), col = v >= 0 ? `25,210,122` : `255,74,74`;
        t += `<td class="v" style="background:rgba(${col},${(0.10 + a * 0.55).toFixed(2)})" title="${id} · ${eq}">${v === 0 ? "0.0" : sg(v)}</td>`;
      });
      t += `</tr>`;
    });
    t += `</tbody></table><div class="hm-leg">表內數字＝若依今天讀數代入該情境方程式，2× 多單之後 H 個交易日<b>相對平常的額外報酬（百分點）</b> · 顏色越深＝幅度越大 · “·”＝該格沒有穩定的方程式</div>`;

    // ---------- read-out ----------
    const grp = hz => ROWS.flatMap(r => r.ids[hz] ? [out(r.ids[hz])] : []);
    const short = grp(20), mid = grp(60), long = [...grp(120), ...grp(250)];
    const lowDays = (meta("P13-20") || {}).low_days;
    let tone, head, pills = "";
    pills += low ? `<span class="pill on">LOW MARGIN</span>` : `<span class="pill off">MARGIN NORMAL</span>`;
    pills += elev ? `<span class="pill on am">VIX ELEVATED</span>` : `<span class="pill off">VIX NORMAL</span>`;
    if (low && elev) { tone = "dn"; head = "雙重壓力：低維持率 ＋ VIX 偏高"; }
    else if (low) { tone = "dn"; head = "低維持率區：槓桿資金已被壓到歷史低檔"; }
    else if (elev) { tone = "am"; head = "VIX 偏高：市場恐慌升溫，維持率尚未進入低檔"; }
    else { tone = "mu"; head = "中性：兩項訊號都沒有啟動"; }

    const lines = [];
    lines.push(low
      ? `<b>維持率 ${f(M.M)}%</b>（zM ${sg(M.zM, 2)}）已<b class="dn">低於 145%</b>，進入歷史低維持率區；這一段已持續 <b>${M.episode_days}</b> 個交易日。`
      : `<b>維持率 ${f(M.M)}%</b>（zM ${sg(M.zM, 2)}），高於 145% 共 ${f(M.M - 145, 1)} 點，低維持率項<b>未啟動</b>。`);
    lines.push(`<b>VIX ${f(V.close)}</b>，zV <b>${sg(V.zV, 2)}</b>（${b === "research" ? "研究口徑 T−1" : "最新收盤"}）＝比過去 5 年平均${V.zV >= 0 ? "高" : "低"} ${f(Math.abs(V.zV), 1)} 個標準差；${elev ? "已進入過去 5 年最高的 20%" : "未達過去 5 年前 20% 的門檻"}。`);
    if (low || short.some(v => v !== 0)) {
      lines.push(`<b>代入方程式：</b>歷史上讀數類似的日子，2× 多單之後平均比平常 <b>20 日 ${rng(short)} pp</b>、<b>60 日 ${rng(mid)} pp</b>、<b>120–250 日 ${rng(long)} pp</b>。${low ? "低維持率那一項貢獻最大，且看越久越大。" : "目前只有 VIX 項貢獻。"}`);
    } else {
      lines.push(`<b>代入方程式：</b>兩項都沒啟動，所有情境輸出為 0，沒有歷史統計優勢可讀。`);
    }
    lines.push(`<b class="am">可信度有限：</b>${low ? `2013 年後低維持率只有 ${lowDays} 個交易日、約 4–5 段急跌（多來自 2020 年的反彈），` : ""}一年期窗口僅約 12 個獨立樣本；這些是<b>樣本內歷史平均，不是預測，也不是買賣建議</b>。`);

    host.innerHTML =
      `<div class="sum-l"><div class="ptitle"><span class="pt">OUTPUT MATRIX · 方程式輸出總覽</span><span class="pc">pp · VIX BASIS: ${b === "research" ? "RESEARCH (T−1)" : "LATEST"}</span></div><div class="sum-body">${t}</div></div>` +
      `<div class="sum-r"><div class="ptitle"><span class="pt">READ-OUT · 一眼看懂</span><span class="pc">AUTO</span></div>` +
      `<div class="sum-body"><div class="sum-head"><span class="${tone}">${head}</span></div><div class="sum-pills">${pills}</div><ul>${lines.map(x => `<li>${x}</li>`).join("")}</ul></div></div>`;
  }

  fetch("data/latest.json", { cache: "no-store" }).then(r => r.json()).then(d => {
    L = d; render();
    const bs = document.getElementById("basis");
    if (bs) bs.addEventListener("click", () => render());   // registered after app.js, so the toggle state is already updated
  }).catch(() => { host.innerHTML = ""; });
})();
