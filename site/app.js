"use strict";
/* TW Margin Monitor — front end. Static page; all numbers come from data/latest.json and data/history.json
   produced by pipeline/update.py (TWSE + CBOE primary sources). No numeric value is typed in by hand. */

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const f = (x, d = 2) => (x == null || Number.isNaN(x)) ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sg = (x, d = 2) => (x == null || Number.isNaN(x)) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const cls = x => x > 0 ? "up" : x < 0 ? "dn" : "mu";
const T = d => Date.parse(d + "T00:00:00Z");

let LAT, HIS, basis = "research", rangeKey = "1Y";
const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 1096, "5Y": 1827, "10Y": 3653, "MAX": 1e9 };

/* ---------------- boot ---------------- */
Promise.all([
  fetch("data/latest.json", { cache: "no-store" }).then(r => r.json()),
  fetch("data/history.json", { cache: "no-store" }).then(r => r.json()),
]).then(([l, h]) => {
  LAT = l; HIS = h;
  prep(); renderFeeds(); renderStrip(); renderLadder(); renderRaw(); renderModels(); renderEpisodes(); renderForward(); renderFoot();
  buildRange(); drawAll(); clocks(); setInterval(clocks, 1000);
  new ResizeObserver(() => drawAll()).observe($("#chartwrap"));
}).catch(e => {
  document.body.insertAdjacentHTML("afterbegin", `<div style="padding:24px;color:#ff4a4a;font-family:monospace">DATA LOAD ERROR: ${e}. Serve this folder over HTTP (e.g. <code>python -m http.server</code>) so data/*.json can be fetched.</div>`);
});

function prep() {
  HIS.m.t = HIS.m.d.map(T);
  HIS.vix.t = HIS.vix.d.map(T);
}

/* ---------------- header ---------------- */
function ageDays(iso) { return Math.floor((Date.now() - T(iso)) / 864e5); }
function renderFeeds() {
  const a = ageDays(LAT.tw_date), b = ageDays(LAT.vix_date_latest);
  const lv = n => n <= 4 ? "" : n <= 7 ? "stale" : "dead";
  $("#feeds").innerHTML =
    `<div class="feed"><span class="led ${lv(a)}"></span>TWSE MARGIN <b>${LAT.tw_date}</b></div>` +
    `<div class="feed"><span class="led ${lv(b)}"></span>CBOE VIX <b>${LAT.vix_date_latest}</b></div>` +
    `<div class="feed">BUILD <b>${LAT.generated_utc.replace("T", " ").replace("+00:00", "Z")}</b></div>`;
}
function clocks() {
  const now = new Date();
  const fmt = tz => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  $("#clkTPE").textContent = fmt("Asia/Taipei");
  $("#clkNYC").textContent = fmt("America/New_York");
}

/* ---------------- KPI strip ---------------- */
function renderStrip() {
  const M = LAT.margin, V = LAT.vix_latest, R = LAT.vix_research;
  const low = M.L145 === 1;
  const tiles = [
    { cls: "hero" + (low ? " alert" : ""), lbl: "MARGIN RATIO", zh: "上市融資維持率", val: f(M.M) + "%", sub: `<span class="${cls(M.chg_1d)}">${sg(M.chg_1d)}</span> 1D · ${sg(M.chg_5d)} 5D · ${sg(M.chg_20d)} 20D` },
    { lbl: "zM", zh: "維持率 z", val: sg(M.zM, 2), sub: `5Y μ ${f(M.mean_5y, 1)} · σ ${f(M.sd_5y, 1)}`, vc: cls(M.zM) },
    { lbl: "LOW-MARGIN FLAG", zh: "[M<145]", val: low ? `<span class="pill on">ACTIVE</span>` : `<span class="pill off">INACTIVE</span>`, sub: low ? `${M.episode_days} session(s) in current episode` : `${f(M.dist["145"])} pts above 145`, small: true },
    { cls: "hero", lbl: "VIX CLOSE", zh: "恐慌指數", val: f(V.close), sub: `<span class="${cls(V.chg_1d)}">${sg(V.chg_1d)}</span> 1D · ${sg(V.chg_5d)} 5D · ${sg(V.chg_20d)} 20D` },
    { lbl: "zV · RESEARCH", zh: "T−1 基準", val: sg(R.zV, 2), sub: `VIX ${f(R.close)} on ${R.date}`, vc: cls(R.zV) },
    { lbl: "zV · LATEST", zh: "最新收盤", val: sg(V.zV, 2), sub: `ln-VIX 5Y μ ${f(V.mean_lnV_5y, 3)} σ ${f(V.sd_lnV_5y, 3)}`, vc: cls(V.zV) },
    { lbl: "VIX P80 SIGNAL", zh: "加碼訊號", val: V.signal ? `<span class="pill on am">ELEVATED</span>` : `<span class="pill off">NORMAL</span>`, sub: `zV ${sg(V.zV, 2)} vs P80 ${f(V.p80, 2)}`, small: true },
    { lbl: "VIX 52W RANGE", zh: "", val: `${f(V.low_52w, 1)} – ${f(V.high_52w, 1)}`, sub: `5Y pctile <b class="am">${f(V.pctile_5y, 0)}</b> · all <b class="am">${f(V.pctile_all, 0)}</b>`, mid: true },
  ];
  const s = $("#strip"); s.innerHTML = "";
  tiles.forEach(t => {
    const d = el("div", "tile " + (t.cls || ""));
    d.innerHTML = `<div class="lbl">${t.lbl}<i>${t.zh}</i></div><div class="val ${t.vc || ""}" ${t.small ? 'style="font-size:20px;padding:4px 0 3px"' : t.mid ? 'style="font-size:20px;padding:4px 0 3px"' : ""}>${t.val}</div><div class="sub">${t.sub}</div>`;
    s.appendChild(d);
  });
}

/* ---------------- ladder ---------------- */
function renderLadder() {
  const M = LAT.margin, lo = 115, hi = 225, lv = LAT.ref_levels;
  const pos = x => Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100));
  const zones = [[lo, 145, "#5c1414"], [145, 150, "#6b3a0a"], [150, 170, "#3a2d0a"], [170, 205, "#151b22"], [205, 210, "#0b3a4d"], [210, hi, "#0b4f6b"]];
  let h = `<div class="lad"><div class="lad-bar">` + zones.map(z => `<span style="width:${pos(z[1]) - pos(z[0])}%;background:${z[2]}"></span>`).join("") + `</div>`;
  lv.forEach(x => h += `<div class="lad-tick${x === 150 || x === 210 ? " lo" : ""}" style="left:${pos(x)}%"><em>${x}</em></div>`);
  h += `<div class="lad-tick cur" style="left:${pos(M.M)}%"><em>${f(M.M, 1)}</em></div></div>`;
  h += `<table class="dist">` + lv.map(x => { const d = M.dist[String(x)]; return `<tr><td>vs ${x}%</td><td class="${cls(d)}">${sg(d)} pts</td></tr>`; }).join("") +
    `<tr><td>52W high / low</td><td>${f(M.high_52w)} / ${f(M.low_52w)}</td></tr>` +
    `<tr><td>Percentile · 5Y / all</td><td>${f(M.pctile_5y, 0)} / ${f(M.pctile_all, 0)}</td></tr></table>`;
  h += `<div class="lvl-note">Reference lines 145 / 150 / 170 / 205 / 210 are the research's original rule thresholds, shown for context only.</div>`;
  $("#ladderBody").innerHTML = h;
}

/* ---------------- raw data ---------------- */
function renderRaw() {
  const M = LAT.margin, V = LAT.vix_latest, R = LAT.vix_research;
  const kv = (k, zh, v) => `<div class="kv"><span class="k">${k}${zh ? `<i>${zh}</i>` : ""}</span><span class="v">${v}</span></div>`;
  $("#rawBody").innerHTML =
    `<div class="rawgrp"><h4>TWSE · MI_MARGN / MI_INDEX<span>${LAT.tw_date}</span></h4>` +
    kv("Margin ratio M", "維持率", `<b class="am">${f(M.M, 3)}%</b>`) +
    kv("Prior session M", "前一交易日", `${f(M.prev_M, 3)}%`) +
    kv("Margin balance (lots)", "融資餘額 張", f(M.units, 0)) +
    kv("Margin amount (NT$ k)", "融資金額 仟元", f(M.amt_k, 0)) +
    kv("Collateral mkt value (NT$)", "擔保品市值", f(M.mv_ntd / 1e8, 2) + " 億") +
    kv("Securities w/ balance", "有融資餘額檔數", f(M.n_sec, 0)) +
    kv("No close today → last close", "無成交價沿用", `${f(M.n_no_price, 0)} · ${f(M.mv_share_no_price * 100, 3)}% mv`) +
    `</div>` +
    `<div class="rawgrp"><h4>CBOE · VIX_History<span>${V.date}</span></h4>` +
    kv("Open", "", f(V.open)) + kv("High", "", f(V.high)) + kv("Low", "", f(V.low)) +
    kv("Close", "", `<b class="cy">${f(V.close)}</b>`) + kv("Prior close", "", f(V.prev_close)) +
    kv("ln(VIX)", "", f(Math.log(V.close), 4)) +
    kv("5Y mean ln / σ", "", `${f(V.mean_lnV_5y, 3)} / ${f(V.sd_lnV_5y, 3)}`) +
    `</div>` +
    `<div class="rawgrp"><h4>RESEARCH BASIS · T−1<span>${R.date}</span></h4>` +
    kv("VIX close used", "", f(R.close)) + kv("zV", "", sg(R.zV, 3)) + kv("P80 threshold", "", f(R.p80, 3)) + `</div>`;
}

/* ---------------- model matrix ---------------- */
function renderModels() {
  const scn = LAT.scenario_meta.scenarios, ev = LAT.scenarios[basis];
  const zv = basis === "research" ? LAT.vix_research.zV : LAT.vix_latest.zV, L = LAT.margin.L145;
  const maxAbs = Math.max(8, ...ev.map(e => Math.abs(e.total_pp)));
  let h = `<thead><tr><th>ID</th><th>WINDOW</th><th>HORIZON</th><th>EQUATION · pp excess</th><th>VIX TERM<br>b·zV (90% CI)</th><th>LOW-MARGIN TERM<br>c·[M&lt;145] (90% CI)</th><th>NOW (pp)</th><th>N · INDEP · LOW DAYS</th><th style="text-align:left">NOTE</th></tr></thead><tbody>`;
  scn.forEach((s, i) => {
    const e = ev[i], tv = s.terms.find(t => t.var === "zV"), tl = s.terms.find(t => t.var === "L145");
    const eq = s.terms.map(t => t.var === "zV" ? `<b>${sg(t.coef)}</b>·zV` : `<b>${sg(t.coef)}</b>·[M&lt;145]`).join(" ");
    const cv = e.contrib.find(c => c.var === "zV"), cl = e.contrib.find(c => c.var === "L145");
    const ci = (t, c, x) => t ? `<span class="${cls(c.contrib)}">${sg(c.contrib)}</span> <span class="mu">= ${f(t.coef, 1)} × ${x}</span>${ciBar(t)}` : `<span class="cnt">n.s.</span>`;
    const tot = e.total_pp;
    h += `<tr class="${L && tl ? "active" : ""}"><td><span class="id">${s.id}</span></td><td>${s.label}<br><span class="cnt">${s.window}</span></td><td>${s.horizon}D</td>` +
      `<td class="eq">${eq}</td><td>${ci(tv, cv, sg(zv, 2))}</td><td>${ci(tl, cl, L)}</td>` +
      `<td><span class="big ${cls(tot)}">${sg(tot)}</span></td><td class="cnt">${f(s.n, 0)} · ${f(s.indep_windows, 1)} · ${s.low_days}</td><td class="note">${s.note}</td></tr>`;
  });
  const E = LAT.scenario_meta.early;
  h += `<tr class="early"><td><span class="id" style="color:var(--faint)">${E.id}</span></td><td>${E.label}</td><td>20–250D</td><td class="eq">—</td><td>—</td><td>—</td><td><span class="big">0.00</span></td><td>—</td><td class="note">${E.note}</td></tr></tbody>`;
  $("#mtable").innerHTML = h;
  $("#basis").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.b === basis));
}
function ciBar(t) {
  const lo = Math.min(0, t.lo), hi = Math.max(t.hi, 0.0001), span = hi - lo, p = x => (x - lo) / span * 70;
  return `<span class="ci"><u style="left:${p(0)}px"></u><i style="left:${p(t.lo)}px;width:${Math.max(1, p(t.hi) - p(t.lo))}px"></i><b style="left:${p(t.coef)}px"></b></span><span class="cnt"> [${f(t.lo, 1)}, ${f(t.hi, 1)}]</span>`;
}
$("#basis").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { basis = b.dataset.b; renderModels(); } });

/* ---------------- episodes / forward log ---------------- */
function renderEpisodes() {
  const eps = LAT.episodes_below_145.slice().reverse();
  let h = `<thead><tr><th>START</th><th>END</th><th>SESSIONS</th><th>MIN M</th><th>MIN DATE</th></tr></thead><tbody>`;
  eps.forEach(e => {
    const live = e.end === LAT.tw_date && LAT.margin.L145 === 1;
    h += `<tr><td>${e.start}</td><td>${e.end}${live ? ` <span class="pill on" style="font-size:9px;padding:0 5px">LIVE</span>` : ""}</td><td>${e.days}</td><td class="dn">${f(e.min_M)}</td><td class="mu">${e.min_date}</td></tr>`;
  });
  $("#etable").innerHTML = h + "</tbody>";
}
function renderForward() {
  const rows = (LAT.forward_log || []).slice().reverse();
  if (!rows.length) { $("#ftable").outerHTML = `<div class="empty">No post-freeze sessions logged yet.</div>`; return; }
  let h = `<thead><tr><th>DATE</th><th>M %</th><th>zM</th><th>[M&lt;145]</th><th>LOGGED (UTC)</th></tr></thead><tbody>`;
  rows.forEach(r => h += `<tr><td>${r.date}</td><td>${f(r.M)}</td><td class="${cls(r.zM)}">${sg(r.zM)}</td><td>${r.L145 ? '<span class="dn">1</span>' : '<span class="mu">0</span>'}</td><td class="mu">${r.logged_utc.slice(0, 19).replace("T", " ")}</td></tr>`);
  $("#ftable").innerHTML = h + "</tbody>";
}
function renderFoot() {
  $("#foot").innerHTML =
    `<div><b>DEFINITIONS</b>M = Σ(margin balance × 1,000 × close) ÷ margin amount, all TWSE-listed securities incl. ETFs, balances as first published the same evening. ` +
    `zM / zV = value standardised on the previous 1,260 sessions (≈5Y), excluding the observation. zV uses ln(VIX). [M&lt;145] = 1 when M &lt; 145%. ` +
    `VIX P80 signal: zV ≥ 80th percentile of the prior 1,260 daily zV values.</div>` +
    `<div><b>SOURCES</b>Margin: <code>twse.com.tw</code> MI_MARGN (selectType=ALL) + MI_INDEX. VIX: <code>cdn.cboe.com</code> VIX_History.csv. ` +
    `Not the Goodinfo/愛玩股 page; recomputed from exchange data and independent of third-party snapshots. TWSE's own “整戶擔保維持率” is a different measure.</div>` +
    `<div><b>CAVEATS</b>Equation coefficients are in-sample conditional averages of 2× long excess return from the research (stage 8), 2009–2025, simulated 2× series without dividends or fees. ` +
    `Low-margin windows rest on ~4–5 episodes; one-year horizons have ~12 independent windows. Terms with 90% CI spanning 0 are hidden (n.s.). No out-of-sample validation; forward log above is the live check.</div>`;
}

/* ====================== CHARTS ====================== */
const panes = [
  { id: "pane1", title: "TWSE MARGIN RATIO", zh: "融資維持率 %", kind: "m" },
  { id: "pane2", title: "CBOE VIX", zh: "恐慌指數", kind: "vix" },
  { id: "pane3", title: "STANDARDISED", zh: "zV (cyan) · zM (amber)", kind: "z" },
];
let hoverT = null, t0 = 0, t1 = 0;
const C = { amber: "#ffb000", cyan: "#35c2ff", up: "#19d27a", dn: "#ff4a4a", grid: "#141a21", txt: "#7d8895", line2: "#2a323d" };

function buildRange() {
  const r = $("#range");
  Object.keys(RANGES).forEach(k => { const b = el("button", k === rangeKey ? "on" : "", k); b.onclick = () => { rangeKey = k; r.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.textContent === k)); drawAll(); }; r.appendChild(b); });
  panes.forEach(p => {
    const c = $("#" + p.id + " canvas");
    c.addEventListener("mousemove", e => { const rc = c.getBoundingClientRect(), x = e.clientX - rc.left; hoverT = xToT(x, rc.width); drawAll(); });
    c.addEventListener("mouseleave", () => { hoverT = null; drawAll(); });
    c.addEventListener("touchmove", e => { const rc = c.getBoundingClientRect(); hoverT = xToT(e.touches[0].clientX - rc.left, rc.width); drawAll(); }, { passive: true });
  });
}
const PAD = { l: 8, r: 58, t: 26, b: 18 };
const xToT = (x, w) => t0 + (x - PAD.l) / (w - PAD.l - PAD.r) * (t1 - t0);
const tToX = (t, w) => PAD.l + (t - t0) / (t1 - t0) * (w - PAD.l - PAD.r);

function bs(arr, t) { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return lo; }
function nearest(arr, t) { let i = bs(arr, t); if (i > 0 && Math.abs(arr[i - 1] - t) < Math.abs(arr[i] - t)) i--; return i; }

function drawAll() {
  if (!HIS) return;
  const tEnd = Math.max(HIS.m.t.at(-1), HIS.vix.t.at(-1));
  const days = RANGES[rangeKey];
  t1 = tEnd + 864e5 * Math.min(3, days / 20); t0 = Math.max(HIS.m.t[0], tEnd - days * 864e5);
  if (rangeKey === "MAX") t0 = HIS.m.t[0];
  panes.forEach((p, i) => drawPane(p, i === panes.length - 1));
}

function drawPane(p, showX) {
  const host = $("#" + p.id), cv = $("canvas", host), dpr = window.devicePixelRatio || 1;
  const w = host.clientWidth, h = host.clientHeight;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.font = "10.5px 'IBM Plex Mono',monospace"; g.textBaseline = "middle";
  const px0 = PAD.l, px1 = w - PAD.r, py0 = PAD.t, py1 = h - PAD.b - (showX ? 4 : -8);

  let series = [], refs = [], seriesKeys;
  const slice = (ts, vals) => { const a = Math.max(0, bs(ts, t0) - 1), b = Math.min(ts.length, bs(ts, t1 + 1) + 1); return { a, b, ts, vals }; };
  if (p.kind === "m") {
    series = [{ ...slice(HIS.m.t, HIS.m.v), color: "#e8e8e8", w: 1.5, name: "M", fmt: v => f(v) + "%" }];
    refs = [{ y: 145, c: C.dn, d: [5, 3], l: "145" }, { y: 150, c: "#a8741a", d: [2, 3], l: "150" }, { y: 170, c: "#a8741a", d: [2, 3], l: "170" }, { y: 205, c: "#1f8fb8", d: [2, 3], l: "205" }, { y: 210, c: "#1f8fb8", d: [2, 3], l: "210" }];
  } else if (p.kind === "vix") {
    series = [{ ...slice(HIS.vix.t, HIS.vix.c), color: C.cyan, w: 1.4, name: "VIX", fmt: v => f(v), candle: true }];
    refs = [{ y: 20, c: "#3a4551", d: [2, 3], l: "20" }, { y: 30, c: "#6b3a1a", d: [2, 3], l: "30" }];
  } else {
    series = [{ ...slice(HIS.vix.t, HIS.vix.z), color: C.cyan, w: 1.2, name: "zV", fmt: v => sg(v) }, { ...slice(HIS.m.t, HIS.m.z), color: C.amber, w: 1.2, name: "zM", fmt: v => sg(v) }];
    refs = [{ y: 0, c: "#3a4551", d: [], l: "0" }, { y: 2, c: "#2a323d", d: [2, 3], l: "+2" }, { y: -2, c: "#2a323d", d: [2, 3], l: "−2" }];
  }
  // y range
  let mn = Infinity, mx = -Infinity;
  series.forEach(s => { for (let i = s.a; i < s.b; i++) { const t = s.ts[i]; if (t < t0 || t > t1) continue; const v = s.vals[i]; if (v == null) continue; if (v < mn) mn = v; if (v > mx) mx = v; if (s.candle) { const hh = HIS.vix.h[i], ll = HIS.vix.l[i]; if (hh > mx) mx = hh; if (ll < mn) mn = ll; } } });
  if (!isFinite(mn)) { mn = 0; mx = 1; }
  const span0 = mx - mn || 1;
  refs.forEach(r => { if (r.y >= mn - span0 * .3 && r.y <= mx + span0 * .3) { mn = Math.min(mn, r.y); mx = Math.max(mx, r.y); } });
  const pad = (mx - mn) * .07; mn -= pad; mx += pad;
  const Y = v => py1 - (v - mn) / (mx - mn) * (py1 - py0);

  // grid + y labels
  const nt = 4, step = niceStep((mx - mn) / nt);
  g.lineWidth = 1; g.strokeStyle = C.grid; g.fillStyle = C.txt; g.textAlign = "left";
  for (let v = Math.ceil(mn / step) * step; v <= mx; v += step) { const y = Math.round(Y(v)) + .5; g.beginPath(); g.moveTo(px0, y); g.lineTo(px1, y); g.stroke(); g.fillText(f(v, step < 1 ? 1 : 0), px1 + 6, y); }
  // x ticks
  const ticks = xTicks();
  ticks.forEach(tk => { const x = Math.round(tToX(tk.t, w)) + .5; if (x < px0 || x > px1) return; g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x, py0); g.lineTo(x, py1); g.stroke(); if (showX) { g.fillStyle = C.txt; g.textAlign = "center"; g.fillText(tk.l, x, h - 7); } });
  g.strokeStyle = C.line2; g.beginPath(); g.moveTo(px0, py1 + .5); g.lineTo(px1, py1 + .5); g.stroke();

  // low-margin zone (M pane)
  g.save(); g.beginPath(); g.rect(px0, py0 - 2, px1 - px0, py1 - py0 + 2); g.clip();
  if (p.kind === "m") { const y145 = Y(145); g.fillStyle = "rgba(255,74,74,.07)"; g.fillRect(px0, y145, px1 - px0, py1 - y145); }
  // refs
  refs.forEach(r => { if (r.y < mn || r.y > mx) return; const y = Math.round(Y(r.y)) + .5; g.strokeStyle = r.c; g.setLineDash(r.d); g.beginPath(); g.moveTo(px0, y); g.lineTo(px1, y); g.stroke(); g.setLineDash([]); });
  // series
  series.forEach(s => {
    if (s.candle && (s.b - s.a) <= 170) {
      const bw = Math.max(1.5, (px1 - px0) / Math.max(1, (t1 - t0) / 864e5) * .55);
      for (let i = s.a; i < s.b; i++) { const t = s.ts[i]; if (t < t0 - 864e5 || t > t1) continue; const x = tToX(t, w), o = HIS.vix.o[i], hh = HIS.vix.h[i], ll = HIS.vix.l[i], c = HIS.vix.c[i], upc = c >= o ? C.up : C.dn;
        g.strokeStyle = upc; g.fillStyle = upc; g.beginPath(); g.moveTo(x, Y(hh)); g.lineTo(x, Y(ll)); g.stroke(); const y0 = Y(Math.max(o, c)), y1 = Math.max(Y(Math.min(o, c)), y0 + 1); g.fillRect(x - bw / 2, y0, bw, y1 - y0); }
      return;
    }
    g.strokeStyle = s.color; g.lineWidth = s.w; g.lineJoin = "round"; g.beginPath(); let started = false;
    for (let i = s.a; i < s.b; i++) { const v = s.vals[i]; if (v == null) { started = false; continue; } const x = tToX(s.ts[i], w), y = Y(v); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
    g.stroke();
  });
  g.restore();

  // axis tags for last values + ref labels
  g.textAlign = "left";
  refs.forEach(r => { if (r.y < mn || r.y > mx || p.kind === "z") return; g.fillStyle = r.c === C.dn ? C.dn : "#6b7480"; g.font = "9.5px 'IBM Plex Mono',monospace"; g.fillText(r.l, px0 + 3, Y(r.y) - 6); });
  g.font = "10.5px 'IBM Plex Mono',monospace";
  series.forEach(s => { const i = s.b - 1; let k = i; while (k >= s.a && s.vals[k] == null) k--; if (k < s.a) return; const v = s.vals[k], y = Y(v); if (s.ts[k] > t1) return;
    g.fillStyle = s.color; g.fillRect(px1 + 1, y - 8, PAD.r - 2, 16); g.fillStyle = "#000"; g.font = "600 10.5px 'IBM Plex Mono',monospace"; g.fillText(p.kind === "z" ? sg(v, 2) : f(v, 2), px1 + 5, y + 1); g.font = "10.5px 'IBM Plex Mono',monospace"; });

  // crosshair
  const lg = $(".legend", host);
  let legend = `<span class="t">${p.title}<i>${p.zh}</i></span>`;
  series.forEach(s => {
    const idx = hoverT == null ? Math.min(s.ts.length - 1, s.b - 1) : nearest(s.ts, hoverT);
    let k = idx; while (k > 0 && s.vals[k] == null) k--;
    const v = s.vals[k]; const d = new Date(s.ts[k]).toISOString().slice(0, 10);
    let extra = "";
    if (s.candle) extra = ` <span class="mu">O ${f(HIS.vix.o[k])} H ${f(HIS.vix.h[k])} L ${f(HIS.vix.l[k])}</span>`;
    legend += `<span class="it" style="color:${s.color}">${s.name}<b>${v == null ? "—" : s.fmt(v)}</b>${extra} <span class="mu">${hoverT != null || p.kind !== "z" ? d : ""}</span></span>`;
  });
  lg.innerHTML = legend;
  if (hoverT != null && hoverT >= t0 && hoverT <= t1) {
    const x = Math.round(tToX(hoverT, w)) + .5; g.strokeStyle = "rgba(255,255,255,.35)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, py0); g.lineTo(x, py1); g.stroke(); g.setLineDash([]);
    series.forEach(s => { const k = nearest(s.ts, hoverT), v = s.vals[k]; if (v == null) return; g.fillStyle = s.color; g.beginPath(); g.arc(tToX(s.ts[k], w), Y(v), 3, 0, 6.3); g.fill(); });
  }
}

function niceStep(raw) { const e = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / e; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e; }
function xTicks() {
  const span = (t1 - t0) / 864e5, out = [], d0 = new Date(t0);
  const lab = (d, y) => y ? String(d.getUTCFullYear()) : d.toISOString().slice(0, 7);
  if (span <= 75) { for (let t = t0; t <= t1; t += 864e5) { const d = new Date(t); if (d.getUTCDay() === 1) out.push({ t, l: d.toISOString().slice(5, 10) }); } }
  else if (span <= 760) { const step = span <= 400 ? 1 : 3; let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); for (let i = 0; i < 80; i++) { const t = Date.UTC(y, m, 1); if (t > t1) break; if (t >= t0 && (m % step === 0)) out.push({ t, l: lab(new Date(t)) }); m++; if (m > 11) { m = 0; y++; } } }
  else { const step = span <= 2200 ? 1 : span <= 4400 ? 2 : 4; for (let y = d0.getUTCFullYear(); y <= new Date(t1).getUTCFullYear(); y++) { const t = Date.UTC(y, 0, 1); if (t >= t0 && t <= t1 && y % step === 0) out.push({ t, l: String(y) }); } }
  return out;
}
